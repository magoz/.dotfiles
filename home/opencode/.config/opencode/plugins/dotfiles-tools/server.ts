// `create_worktree` server side (OpenCode V2 Effect API). The server never allocates and never
// reads its inherited Herdr pane identity: it queues the request for the one live TUI bound to
// the root session (see bridge.ts), which confirms and runs the CLI in its own pane.
import path from "node:path"
import type { Plugin } from "@opencode/plugin/effect/plugin"
import type { RpcHandlers, RpcRegistration } from "@opencode/plugin/effect/rpc"
import { Session } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import { Data, Effect, Option, Schema, type Scope, Stream } from "effect"
import { portable } from "../shared/portable.ts"
import { makeBridge } from "./bridge.ts"
import { WorktreeInput, WorktreeOutput, bridgeDefinition, type WorktreeOutput as Output } from "./contract.ts"
import { BASE_GUIDANCE, LINK_GUIDANCE, resolveInput } from "./worktree.ts"

const REQUEST_TIMEOUT = "32 minutes"
const DESCRIPTION = `Only when the user explicitly asks: create/provision a Herdr worktree and fresh OpenCode destination. Requires root session and a unique pane-local TUI confirmation. Source remains open. ${BASE_GUIDANCE} ${LINK_GUIDANCE}`
const READY_NOTE =
  "Destination owns the task. Do not continue implementation in the source. Source retained explicitly: review destination, then manually exit only this source TUI. Do not retry a successful allocation."

class HandoffError extends Data.TaggedError("HandoffError")<{ readonly message: string }> {}

const ToolInputSchema = portable(WorktreeInput, { exact: true })
const ToolOutputSchema = portable(WorktreeOutput, { exact: true })
export type CreateWorktreeTool = Tool.Info<typeof ToolInputSchema, typeof ToolOutputSchema>

interface SessionLike {
  readonly id: string
  readonly parentID?: string | undefined
  readonly subpath?: string | undefined
  readonly location: { readonly directory: string; readonly workspaceID?: string | undefined }
}

/** The slice of OpenCode's plugin `Context` used here; the real `Context` satisfies it (see default export). */
export interface Host {
  readonly location: { readonly directory: string; readonly workspaceID?: string | undefined }
  readonly session: { readonly get: (input: { readonly sessionID: Session.ID }) => Effect.Effect<SessionLike, unknown> }
  readonly event: { readonly subscribe: () => Stream.Stream<unknown, unknown> }
  readonly rpc: {
    readonly register: (
      rpc: typeof bridgeDefinition,
      handlers: RpcHandlers<typeof bridgeDefinition>,
    ) => Effect.Effect<RpcRegistration<typeof bridgeDefinition>, unknown, Scope.Scope>
  }
  readonly tool: {
    readonly transform: (callback: (editor: { add(tool: CreateWorktreeTool): void }) => void) => Effect.Effect<unknown, never, Scope.Scope>
  }
}

/** Session interruption/deletion; `created` lets a cancellation skip requests made after it. */
const SessionEnd = Schema.Struct({
  type: Schema.Literals(["session.deleted", "session.execution.interrupted"]),
  created: Schema.Finite,
  data: Schema.Struct({ sessionID: Schema.String }),
})
const decodeSessionEnd = Schema.decodeUnknownOption(SessionEnd)

export const setup = (host: Host) =>
  Effect.gen(function* () {
    const bridge = yield* makeBridge()

    /** The root session's working directory, after checking location, subpath and (optionally) root ownership. */
    const sessionDirectory = (sessionID: string, rootOnly: boolean) =>
      Effect.gen(function* () {
        const session = yield* host.session.get({ sessionID: Session.ID.make(sessionID) }).pipe(Effect.mapError(() => new HandoffError({ message: "Invalid session location" })))
        if (session.id !== sessionID || !path.isAbsolute(session.location.directory)) return yield* new HandoffError({ message: "Invalid session location" })
        if (rootOnly && session.parentID) return yield* new HandoffError({ message: "This operation requires the root session" })
        if (session.location.directory !== host.location.directory || (session.location.workspaceID ?? undefined) !== (host.location.workspaceID ?? undefined)) {
          return yield* new HandoffError({ message: "Session does not belong to this plugin location" })
        }
        if (session.subpath !== undefined && path.isAbsolute(session.subpath)) return yield* new HandoffError({ message: "Invalid session subpath" })
        const cwd = path.resolve(session.location.directory, session.subpath ?? ".")
        const relative = path.relative(session.location.directory, cwd)
        if (relative === ".." || relative.startsWith(`..${path.sep}`)) return yield* new HandoffError({ message: "Session subpath escapes location" })
        return cwd
      })

    // Interruption and deletion cancel this session's pending pane request. The tool fiber is
    // interrupted by the host too; the events also cover a deletion while a request waits.
    yield* host.event.subscribe().pipe(
      Stream.runForEach((event) =>
        Option.match(decodeSessionEnd(event), {
          onNone: () => Effect.void,
          onSome: (end) => bridge.cancelSession(end.data.sessionID, end.type === "session.deleted" ? Number.POSITIVE_INFINITY : end.created),
        }),
      ),
      Effect.ignore,
      Effect.forkScoped,
    )

    const execute = (input: WorktreeInput, tool: { readonly sessionID: string }) =>
      Effect.gen(function* () {
        const resolved = yield* Effect.try({ try: () => resolveInput(input), catch: (error) => new HandoffError({ message: error instanceof Error ? error.message : "Invalid input" }) })
        const cwd = yield* sessionDirectory(tool.sessionID, true)
        const outcome = yield* bridge.request({ sessionID: tool.sessionID, rootID: tool.sessionID, cwd, input: resolved }, REQUEST_TIMEOUT)
        if (outcome.status === "failed") return yield* new HandoffError({ message: outcome.reason })
        const output: Output = outcome.status === "vercel_link_required" ? { ...outcome, retry: resolved } : outcome
        return { output, content: `${JSON.stringify(output)}\n${outcome.status === "vercel_link_required" ? LINK_GUIDANCE : READY_NOTE}` }
      }).pipe(Effect.mapError((error) => new Tool.Error({ message: error.message })))

    const asRpcFailure = <A, E extends { readonly message: string }>(effect: Effect.Effect<A, E>) => effect.pipe(Effect.catch((error) => Effect.die(new Error(error.message))))
    yield* host.rpc
      .register(bridgeDefinition, {
        // A TUI binds only to a root session of this location.
        pulse: (input) => sessionDirectory(input.rootID, true).pipe(Effect.andThen(bridge.pulse(input)), asRpcFailure),
        authorize: (input) => bridge.authorize(input),
        complete: (input) => bridge.complete(input).pipe(asRpcFailure),
        release: (input) => bridge.release(input),
      })
      .pipe(Effect.orDie)

    yield* host.tool.transform((editor) => {
      editor.add({
        name: "create_worktree",
        description: DESCRIPTION,
        input: ToolInputSchema,
        output: ToolOutputSchema,
        options: { codemode: false, permission: "create_worktree" },
        execute,
      })
    })
    return { bridge, execute, sessionDirectory }
  })

export default {
  id: "dotfiles-tools",
  effect: (ctx) => setup(ctx).pipe(Effect.asVoid),
} satisfies Plugin
