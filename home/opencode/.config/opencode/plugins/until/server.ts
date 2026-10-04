// `until` server plugin (OpenCode V2 Effect API): the agent tool, the TUI RPC, and session-event
// wiring for one location. No confirmation dialog: like pi-until, the tool is gated only by
// the agent's `shell` permission.
import { statSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin/effect/plugin"
import type { RpcHandlers, RpcRegistration } from "@opencode/plugin/effect/rpc"
import type { StorageDomain } from "@opencode/plugin/effect/storage"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { Clock, Deferred, Effect, Option, type Scope, Stream } from "effect"
import { makeCheckRunner, type RunCheck } from "./check.ts"
import {
  FIRST_CHECK_WAIT_MS, TOOL_DESCRIPTION, ToolInput, UntilError, listText, parseCommand, receipt, receiptText,
  startedText, type Origin, type Watch,
} from "./domain.ts"
import { makeEngine, type UiEvent } from "./engine.ts"
import { portable } from "./portable.ts"
import { definition, view } from "./rpc.ts"
import { makeTelemetry, readTelemetry, summarize, summaryText, telemetryOptions, type Telemetry } from "./telemetry.ts"

const MAX_FAMILY_DEPTH = 32
const message = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : String(error)

const isDirectory = (dir: string) => {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

type Brand<T> = T extends { readonly make: (value: string) => infer B } ? B : never
type SessionID = Brand<typeof Session.ID>
type MessageID = Brand<typeof SessionMessage.ID>

/** The session fields `until` reads. OpenCode's `Session.Info` is assignable to it. */
export interface SessionLike {
  readonly id: string
  readonly parentID?: string | undefined
  readonly location: { readonly directory: string; readonly workspaceID?: string | undefined }
  readonly subpath?: string | undefined
  readonly title?: string | undefined
}

const ToolInputSchema = portable(ToolInput)
export type UntilTool = Tool.Info<typeof ToolInputSchema, undefined>

/**
 * The slice of OpenCode's plugin `Context` this plugin uses: consciously narrow, so tests fake
 * exactly this and the compiler checks that the real `Context` satisfies it (see the default export).
 */
export interface Host {
  readonly location: { readonly directory: string; readonly workspaceID?: string | undefined }
  readonly session: {
    readonly get: (input: { readonly sessionID: SessionID }) => Effect.Effect<SessionLike, unknown>
    readonly synthetic: (input: {
      readonly sessionID: SessionID
      readonly id: MessageID
      readonly text: string
      readonly description: string
      readonly metadata: Readonly<Record<string, string | number>>
      readonly delivery: "queue"
      readonly resume: true
    }) => Effect.Effect<unknown, unknown>
    readonly wait: (input: { readonly sessionID: SessionID }) => Effect.Effect<unknown, unknown>
  }
  readonly storage: Pick<StorageDomain, "set" | "remove" | "scan">
  readonly event: { readonly subscribe: () => Stream.Stream<unknown, unknown> }
  readonly rpc: {
    readonly register: (
      rpc: typeof definition,
      handlers: RpcHandlers<typeof definition>,
    ) => Effect.Effect<RpcRegistration<typeof definition>, unknown, Scope.Scope>
  }
  readonly tool: {
    readonly transform: (callback: (editor: { add(tool: UntilTool): void }) => void) => Effect.Effect<unknown, never, Scope.Scope>
  }
}

export interface ServerDeps {
  readonly run?: RunCheck
  readonly telemetry?: Telemetry
  readonly isDirectory?: (dir: string) => boolean
  readonly retryDelays?: Parameters<typeof makeEngine>[0]["retryDelays"]
}

interface Scope {
  /** Watches belong to the family root: a finished subagent is never woken. */
  readonly rootID: string
  /** The calling session's directory, where conditions run. */
  readonly cwd: string
  readonly origin?: Origin
}

export const setup = (ctx: Host, deps: ServerDeps = {}) =>
  Effect.gen(function* () {
    const workspaceID = ctx.location.workspaceID
    const location = { directory: ctx.location.directory, ...(workspaceID ? { workspaceID } : {}) }

    const session = (sessionID: string) =>
      ctx.session.get({ sessionID: Session.ID.make(sessionID) }).pipe(
        Effect.mapError((error) => new UntilError({ message: `Session ${sessionID}: ${message(error)}` })),
        Effect.flatMap((info) =>
          info.id === sessionID && info.location.directory === location.directory && (info.location.workspaceID ?? undefined) === workspaceID
            ? Effect.succeed(info)
            : Effect.fail(new UntilError({ message: "Session does not belong to this plugin location" })),
        ),
      )

    /**
     * Who owns watches armed from `sessionID`. OpenCode reports a subagent's result to its parent
     * once, so waking the finished subagent would do unseen work. Watches belong to the family
     * root instead, which is woken; `origin` records the subagent that armed them.
     */
    const scopeOf = (sessionID: string) =>
      Effect.gen(function* () {
        const info = yield* session(sessionID)
        const cwd = path.resolve(info.location.directory, info.subpath ?? ".")
        const relative = path.relative(info.location.directory, cwd)
        if (relative === ".." || relative.startsWith(`..${path.sep}`)) return yield* new UntilError({ message: "Session subpath escapes its location" })
        let root = info
        for (let depth = 0; root.parentID; depth++) {
          if (depth >= MAX_FAMILY_DEPTH) return yield* new UntilError({ message: "Session family is too deep" })
          root = yield* session(root.parentID)
        }
        if (root.id === sessionID) return { rootID: root.id, cwd } satisfies Scope
        return { rootID: root.id, cwd, origin: { sessionID, ...(info.title ? { title: info.title.slice(0, 120) } : {}) } } satisfies Scope
      })

    const telemetry = deps.telemetry ?? (yield* makeTelemetry(telemetryOptions()))
    const rpc = yield* Deferred.make<{ readonly emit: (event: UiEvent) => Effect.Effect<void> }>()
    const engine = yield* makeEngine({
      location,
      run: deps.run ?? makeCheckRunner(),
      synthetic: (input) =>
        ctx.session.synthetic({
          ...input, sessionID: Session.ID.make(input.sessionID), id: SessionMessage.ID.make(input.id), delivery: "queue", resume: true,
        }),
      waitIdle: (sessionID) => ctx.session.wait({ sessionID: Session.ID.make(sessionID) }),
      sessionExists: (sessionID) =>
        ctx.session.get({ sessionID: Session.ID.make(sessionID) }).pipe(
          Effect.as(true),
          Effect.catch((error) => Effect.succeed(/not.?found/i.test(message(error)) ? false : undefined)),
        ),
      storage: ctx.storage,
      telemetry,
      emit: (event) => Deferred.await(rpc).pipe(Effect.flatMap((registration) => registration.emit(event))),
      ...(deps.retryDelays ? { retryDelays: deps.retryDelays } : {}),
    })

    // Saved watches load in the background; a storage failure is retried, then reported in replies.
    const loaded = yield* Deferred.make<Option.Option<string>>()
    yield* engine.restore.pipe(
      Effect.retry({ times: 2 }),
      Effect.match({ onSuccess: () => Option.none(), onFailure: (error) => Option.some(message(error)) }),
      Effect.flatMap((warning) => Deferred.succeed(loaded, warning)),
      Effect.forkScoped,
    )
    const ready = Deferred.await(loaded)
    const warn = (text: string) =>
      ready.pipe(
        Effect.map(Option.match({
          onNone: () => text,
          onSome: (warning) => `${text}\n\nWarning: saved until watches could not be loaded (${warning}); earlier watches may not be running.`,
        })),
      )

    // Esc does not stop watches (pi parity): only deletion forgets them. A dropped event stream is
    // resubscribed, then in-flight recurring wakes resync.
    yield* ctx.event.subscribe().pipe(
      Stream.runForEach((event) => engine.handleEvent(event)),
      Effect.ignore,
      Effect.andThen(Effect.sleep("1 second")),
      Effect.andThen(engine.resync),
      Effect.forever,
      Effect.forkScoped,
    )

    const action = (sessionID: string, name: "start" | "repeat" | "list" | "status" | "complete" | "cancel", source: "tool" | "command") =>
      telemetry.record(sessionID, { event: "action", action: name, source })

    const parse = (input: ToolInput, cwd: string) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) =>
          Effect.try({
            try: () => parseCommand(input, { cwd, now, isDirectory: deps.isDirectory ?? isDirectory }),
            catch: (error) => (error instanceof UntilError ? error : new UntilError({ message: message(error) })),
          }),
        ),
      )

    const inlineText = (watch: Watch, now: number) => {
      const lead =
        watch.facts.status === "succeeded"
          ? `Condition is already true (check ${watch.facts.attempts}, exit 0). No watch remains: continue now.`
          : watch.facts.status === "failed"
            ? `The condition could not run${watch.facts.failure ? `: ${watch.facts.failure}` : ""}. No watch remains; fix it and start again.`
            : `The watch ended: ${watch.facts.status}. No watch remains.`
      return `${lead}\n\n${receiptText(receipt(watch, now))}`
    }

    const firstCheckText = (watch: Watch) => {
      const last = watch.facts.lastResult
      if (!last || watch.definition.kind !== "until") return ""
      return ` First check: ${last.killed ? `ran past ${watch.definition.gate.checkTimeoutMs / 1000}s (counted as false)` : `exit ${last.code}`}.`
    }

    const execute = (input: ToolInput, tool: { readonly sessionID: string }) =>
      Effect.gen(function* () {
        yield* ready
        const { rootID, cwd, origin } = yield* scopeOf(tool.sessionID)
        const command = yield* parse(input, cwd)
        yield* action(rootID, command.action, "tool")
        const now = () => Clock.currentTimeMillis
        const reply = (text: string, watch?: Watch) =>
          Effect.all([warn(text), now()]).pipe(
            Effect.map(([content, at]) => ({ content, ...(watch ? { metadata: { until: receipt(watch, at) } } : {}) })),
          )
        const options = origin ? { origin } : {}
        switch (command.action) {
          case "start": {
            const started = yield* engine.start(rootID, command.definition, { ...options, inline: true })
            const { watch, answered } = yield* engine.settleInline(rootID, started.id, FIRST_CHECK_WAIT_MS)
            return yield* reply(answered ? inlineText(watch, yield* now()) : `${startedText(watch)}${firstCheckText(watch)}`, watch)
          }
          case "repeat": {
            const watch = yield* engine.start(rootID, command.definition, options)
            return yield* reply(startedText(watch), watch)
          }
          case "list":
            const at = yield* now()
            return yield* reply(listText(engine.list(rootID).map((watch) => receipt(watch, at))))
          case "status": {
            const { watch } = yield* engine.get(rootID, command.id)
            return yield* reply(receiptText(receipt(watch, yield* now())), watch)
          }
          case "cancel":
          case "complete": {
            const watch = yield* (command.action === "cancel" ? engine.cancel : engine.complete)(rootID, command.id)
            return yield* reply(receiptText(receipt(watch, yield* now())), watch)
          }
        }
      }).pipe(Effect.mapError((error) => new Tool.Error({ message: error.message })))

    /** What the TUI can do. Expected failures are `UntilError`; registration maps them to `until.error`. */
    const api = {
      list: ({ sessionID }: { readonly sessionID: string }) =>
        Effect.gen(function* () {
          yield* ready
          const { rootID } = yield* scopeOf(sessionID)
          return { watches: engine.list(rootID).map((watch) => view(watch, engine.phase(watch))) }
        }),
      start: ({ sessionID, condition }: { readonly sessionID: string; readonly condition: string }) =>
        Effect.gen(function* () {
          yield* ready
          const { rootID, cwd, origin } = yield* scopeOf(sessionID)
          const command = yield* parse({ action: "start", condition }, cwd)
          if (command.action !== "start") return yield* new UntilError({ message: "unexpected command" })
          yield* action(rootID, "start", "command")
          const watch = yield* engine.start(rootID, command.definition, origin ? { origin } : {})
          return { id: watch.id, label: watch.definition.label, status: watch.facts.status }
        }),
      cancel: ({ sessionID, id }: { readonly sessionID: string; readonly id: string }) =>
        Effect.gen(function* () {
          yield* ready
          const { rootID } = yield* scopeOf(sessionID)
          yield* action(rootID, "cancel", "command")
          return { id, status: (yield* engine.cancel(rootID, id)).facts.status }
        }),
      complete: ({ sessionID, id }: { readonly sessionID: string; readonly id: string }) =>
        Effect.gen(function* () {
          yield* ready
          const { rootID } = yield* scopeOf(sessionID)
          yield* action(rootID, "complete", "command")
          return { id, status: (yield* engine.complete(rootID, id)).facts.status }
        }),
      status: ({ sessionID, id }: { readonly sessionID: string; readonly id: string }) =>
        Effect.gen(function* () {
          yield* ready
          const { rootID } = yield* scopeOf(sessionID)
          const { watch } = yield* engine.get(rootID, id)
          return { text: receiptText(receipt(watch, yield* Clock.currentTimeMillis)) }
        }),
      stats: () =>
        telemetry.enabled
          ? readTelemetry(telemetry.filePath).pipe(Effect.map((lines) => ({ text: summaryText(summarize(lines), telemetry.filePath) })))
          : Effect.succeed({ text: "until telemetry is disabled (OPENCODE_UNTIL_TELEMETRY=0)." }),
    }
    const registration = yield* ctx.rpc
      .register(definition, {
        list: (input) => api.list(input).pipe(Effect.orDie),
        start: (input, call) => api.start(input).pipe(Effect.mapError((error) => call.error("until.error", error.message))),
        cancel: (input, call) => api.cancel(input).pipe(Effect.mapError((error) => call.error("until.error", error.message))),
        complete: (input, call) => api.complete(input).pipe(Effect.mapError((error) => call.error("until.error", error.message))),
        status: (input, call) => api.status(input).pipe(Effect.mapError((error) => call.error("until.error", error.message))),
        stats: () => api.stats(),
      })
      .pipe(Effect.orDie)
    yield* Deferred.succeed(rpc, {
      emit: (event) =>
        (event.type === "changed"
          ? registration.events.emit("changed", { sessionID: event.sessionID })
          : registration.events.emit("notify", { sessionID: event.sessionID, title: event.title, message: event.message, variant: event.variant })
        ).pipe(Effect.ignore),
    })

    yield* ctx.tool.transform((editor) => {
      editor.add({
        name: "until",
        description: TOOL_DESCRIPTION,
        // Portable: the host validates tool input with it (see portable.ts).
        input: ToolInputSchema,
        // Direct tool, hidden wherever the agent's `shell` permission is wholly denied.
        options: { codemode: false, permission: "shell" },
        execute,
      })
    })
    return { api, execute }
  })

export default {
  id: "dotfiles-until",
  effect: (ctx) => setup(ctx).pipe(Effect.asVoid),
} satisfies Plugin
