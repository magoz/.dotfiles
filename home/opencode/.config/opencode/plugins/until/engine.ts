// Watch engine for one plugin location. Each running watch is one fiber in a plugin-scoped
// FiberMap: unloading interrupts the fibers without cancelling the watches, and every state
// change is persisted first, so the next generation resumes them. Wakes carry a persisted
// `msg_` ID, so a retried or replayed wake is admitted at most once by OpenCode's inbox.
import type { StorageDomain } from "@opencode/plugin/effect/storage"
import { Clock, Deferred, Duration, Effect, FiberMap, Option, Schema, Semaphore } from "effect"
import type { RunCheck } from "./check.ts"
import {
  MAX_ACTIVE_PER_SESSION, MAX_FINISHED_PER_SESSION, StoredWatchJson, UntilError, advanceAfterTick, coalescePastDue,
  hashCondition, initialFacts, messageID, notifyToast, recurringWake, terminalWake, wakeOf, watchID,
  type Definition, type FinalStatus, type Location, type Origin, type Toast, type Watch,
} from "./domain.ts"
import type { Phase } from "./rpc.ts"
import type { Telemetry } from "./telemetry.ts"

export const STORAGE_PREFIX = "watch/"
/** Wake admission retries. Safe: the message ID is fixed, so a duplicate is the same inbox item. */
const RETRY_DELAYS: readonly Duration.Input[] = [0, "1 second", "5 seconds", "30 seconds"]

export interface WakeInput {
  readonly sessionID: string
  readonly id: string
  readonly text: string
  readonly description: string
  readonly metadata: Readonly<Record<string, string | number>>
}

export type UiEvent =
  | { readonly type: "changed"; readonly sessionID: string }
  | ({ readonly type: "notify"; readonly sessionID: string } & Toast)

export interface EngineDeps {
  /** This plugin instance's location; storage is shared across locations. */
  readonly location: Location
  readonly run: RunCheck
  /** Queues a synthetic message that resumes the session (`delivery: queue`, `resume: true`). */
  readonly synthetic: (input: WakeInput) => Effect.Effect<unknown, unknown>
  /** Resolves when the session's agent loop is idle. */
  readonly waitIdle: (sessionID: string) => Effect.Effect<unknown, unknown>
  /** `undefined` when unknown (transient failure): never forget watches on a guess. */
  readonly sessionExists: (sessionID: string) => Effect.Effect<boolean | undefined>
  readonly storage: Pick<StorageDomain, "set" | "remove" | "scan">
  readonly telemetry: Pick<Telemetry, "record">
  readonly emit: (event: UiEvent) => Effect.Effect<void>
  readonly retryDelays?: readonly Duration.Input[]
}

interface Ending {
  readonly status: FinalStatus
  readonly failure?: string
}

interface Entry {
  watch: Watch
  readonly key: string
  readonly lock: Semaphore.Semaphore
  /** The starting tool call is still waiting: its result answers inline instead of waking. */
  inline: boolean
  checking: boolean
  removed: boolean
  /** Completed after the first check, or when the watch finishes. */
  readonly firstCheck: Deferred.Deferred<void>
  /** Completed when the in-flight recurring wake has run (or was cancelled). */
  settled: Deferred.Deferred<void> | undefined
  idleWait: string | undefined
}

const keyOf = (sessionID: string, id: string) => `${STORAGE_PREFIX}${sessionID}/${id}`
const sameLocation = (a: Location, b: Location) => a.directory === b.directory && a.workspaceID === b.workspaceID
const encode = Schema.encodeSync(StoredWatchJson)
const decode = Schema.decodeUnknownOption(StoredWatchJson)

const SessionEvent = Schema.Struct({
  type: Schema.String,
  data: Schema.Struct({ sessionID: Schema.String, inboxID: Schema.optionalKey(Schema.String) }),
})
const decodeEvent = Schema.decodeUnknownOption(SessionEvent)
const EXECUTION_END = new Set(["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"])

export type Engine = Effect.Success<ReturnType<typeof makeEngine>>

export const makeEngine = Effect.fn("Until.makeEngine")(function* (deps: EngineDeps) {
  const scope = yield* Effect.scope
  const fibers = yield* FiberMap.make<string, void>()
  const entries = new Map<string, Entry>()
  const retryDelays = deps.retryDelays ?? RETRY_DELAYS

  const newEntry = (watch: Watch, inline = false): Entry => ({
    watch,
    key: keyOf(watch.sessionID, watch.id),
    lock: Semaphore.makeUnsafe(1),
    inline,
    checking: false,
    removed: false,
    firstCheck: Deferred.makeUnsafe<void>(),
    settled: undefined,
    idleWait: undefined,
  })

  // ---- persistence and notification -----------------------------------------------------

  /** Writes the entry's current state (or its removal). Serialized per entry, never torn by interruption. */
  const save = (entry: Entry) =>
    Effect.suspend(() => (entry.removed ? deps.storage.remove(entry.key) : deps.storage.set(entry.key, encode(entry.watch)))).pipe(
      Semaphore.withPermits(entry.lock, 1),
      Effect.uninterruptible,
    )

  const emit = (event: UiEvent) => deps.emit(event).pipe(Effect.ignore)

  const changed = (entry: Entry, persist = true) =>
    (persist ? save(entry) : Effect.void).pipe(Effect.andThen(emit({ type: "changed", sessionID: entry.watch.sessionID })))

  const update = (entry: Entry, f: (watch: Watch) => Watch) => Effect.sync(() => { entry.watch = f(entry.watch) })

  const forget = (entry: Entry) =>
    Effect.suspend(() => {
      entry.removed = true
      entries.delete(entry.key)
      return save(entry)
    })

  const startedEvent = (watch: Watch, resumed: boolean) => {
    const d = watch.definition
    return {
      event: "started" as const, id: watch.id, kind: d.kind, label: d.label, wake: wakeOf(d), resumed,
      fromSubagent: watch.origin !== undefined, intervalMs: d.intervalMs, checkTimeoutMs: d.gate?.checkTimeoutMs ?? 0,
      conditionHash: hashCondition(d.gate?.command ?? ""),
      ...(d.expiresAt === undefined ? {} : { timeoutMs: d.expiresAt - watch.facts.startedAt }),
    }
  }

  const finishedEvent = (watch: Watch, now: number) => {
    const { definition: d, facts: f } = watch
    return deps.telemetry.record(watch.sessionID, {
      event: "finished", id: watch.id, kind: d.kind, status: f.status, wake: wakeOf(d), attempts: f.attempts,
      deliveries: f.deliveries, missedTicks: f.missedTicks, reloads: f.reloads, durationMs: (f.finishedAt ?? now) - f.startedAt,
      conditionHash: hashCondition(d.gate?.command ?? ""),
      ...(f.lastResult ? { lastExitCode: f.lastResult.code, lastCheckKilled: f.lastResult.killed } : {}),
    })
  }

  // ---- wake delivery --------------------------------------------------------------------

  /** Admits one wake, retrying with the same ID. Each attempt plus `onAdmitted` is atomic w.r.t. unload. */
  const deliver = (input: WakeInput, onAdmitted: Effect.Effect<void> = Effect.void) =>
    Effect.gen(function* () {
      for (const delay of retryDelays) {
        if (Duration.toMillis(Duration.fromInputUnsafe(delay)) > 0) yield* Effect.sleep(delay)
        const admitted = yield* deps.synthetic(input).pipe(
          Effect.andThen(onAdmitted),
          Effect.as(true),
          Effect.orElseSucceed(() => false),
          Effect.uninterruptible,
        )
        if (admitted) return true
      }
      return false
    })

  const sendNotice = (entry: Entry) =>
    Effect.gen(function* () {
      const notice = entry.watch.notice
      if (!notice || notice.state !== "pending") return
      const { watch } = entry
      const admitted = yield* deliver(
        {
          sessionID: watch.sessionID, id: notice.messageID, text: notice.text, description: notice.description,
          metadata: { source: "until", watchID: watch.id, kind: watch.definition.kind, status: watch.facts.status },
        },
        update(entry, (w) => ({ ...w, notice: { messageID: notice.messageID, state: "sent" } })).pipe(Effect.andThen(changed(entry))),
      )
      if (!admitted) {
        yield* update(entry, (w) => ({ ...w, notice: { ...notice, state: "failed" } }))
        yield* changed(entry)
      }
    })

  const settle = (entry: Entry, id: string) =>
    entry.watch.delivery?.messageID === id && entry.settled ? Deferred.succeed(entry.settled, undefined).pipe(Effect.asVoid) : Effect.void

  /** Settles the current recurring wake once the session's loop is idle; one wait per wake. */
  const settleWhenIdle = (entry: Entry) =>
    Effect.suspend(() => {
      const id = entry.watch.delivery?.messageID
      if (!id || entry.idleWait === id) return Effect.void
      entry.idleWait = id
      return deps.waitIdle(entry.watch.sessionID).pipe(
        Effect.andThen(Effect.suspend(() => settle(entry, id))),
        Effect.ignore,
        Effect.ensuring(Effect.sync(() => { if (entry.idleWait === id) entry.idleWait = undefined })),
        Effect.forkIn(scope),
        Effect.asVoid,
      )
    })

  // ---- the watch fiber ------------------------------------------------------------------

  const finish = (entry: Entry, status: FinalStatus, failure?: string) =>
    Effect.gen(function* () {
      if (entry.watch.facts.status !== "running") return
      entry.checking = false
      const now = yield* Clock.currentTimeMillis
      const d = entry.watch.definition
      yield* update(entry, (w) => {
        const facts = { ...w.facts, status, finishedAt: now, ...(failure ? { failure } : {}) }
        const { delivery: _, ...rest } = w
        return { ...rest, facts: status === "expired" ? coalescePastDue(facts, d.intervalMs, d.expiresAt ?? now) : facts }
      })
      const wake = entry.inline ? undefined : terminalWake(entry.watch, now)
      if (wake) yield* update(entry, (w) => ({ ...w, notice: { messageID: messageID(now), state: "pending", ...wake } }))
      yield* changed(entry)
      yield* finishedEvent(entry.watch, now)
      const toast = entry.inline ? undefined : notifyToast(entry.watch)
      if (toast) yield* emit({ type: "notify", sessionID: entry.watch.sessionID, ...toast })
      if (wake) yield* Effect.forkIn(sendNotice(entry), scope)
      yield* prune(entry.watch.sessionID)
      yield* Deferred.succeed(entry.firstCheck, undefined)
    }).pipe(Effect.uninterruptible)

  /** Queues the next recurring wake; its payload is persisted before sending. */
  const deliverTick = (entry: Entry) =>
    Effect.gen(function* () {
      const watch = entry.watch
      const d = watch.definition
      if (d.kind !== "recurring") return undefined
      const now = yield* Clock.currentTimeMillis
      const facts = advanceAfterTick({ ...watch.facts, deliveries: watch.facts.deliveries + 1 }, d.intervalMs, now)
      const wake = recurringWake({ ...watch, definition: d, facts }, now)
      const id = messageID(now)
      entry.settled = yield* Deferred.make<void>()
      yield* update(entry, (w) => ({ ...w, facts, delivery: { messageID: id, state: "queued", ...wake } }))
      yield* changed(entry)
      return yield* sendTick(entry)
    })

  const sendTick = (entry: Entry) =>
    Effect.gen(function* () {
      const delivery = entry.watch.delivery
      if (!delivery) return undefined
      const admitted = yield* deliver({
        sessionID: entry.watch.sessionID, id: delivery.messageID, text: delivery.text, description: delivery.description,
        metadata: { source: "until", watchID: entry.watch.id, kind: "recurring", delivery: entry.watch.facts.deliveries },
      })
      return admitted ? undefined : ({ status: "failed", failure: "could not queue the recurring wake" } satisfies Ending)
    })

  const loop = (entry: Entry): Effect.Effect<Ending> =>
    Effect.gen(function* () {
      const d = entry.watch.definition
      for (;;) {
        if (entry.watch.delivery) {
          if (!entry.settled) {
            // Restored mid-delivery: re-admit (a no-op if OpenCode already has it), then settle when idle.
            entry.settled = yield* Deferred.make<void>()
            const failed = yield* sendTick(entry)
            if (failed) return failed
            yield* settleWhenIdle(entry)
          }
          yield* Deferred.await(entry.settled)
          entry.settled = undefined
          const now = yield* Clock.currentTimeMillis
          yield* update(entry, ({ delivery: _, ...w }) => ({ ...w, facts: coalescePastDue(w.facts, d.intervalMs, now) }))
          yield* changed(entry)
          continue
        }
        const wait = entry.watch.facts.nextDueAt - (yield* Clock.currentTimeMillis)
        if (wait > 0) yield* Effect.sleep(wait)
        if (!d.gate) {
          const failed = yield* deliverTick(entry)
          if (failed) return failed
          continue
        }
        entry.checking = true
        yield* update(entry, (w) => ({ ...w, facts: { ...w.facts, attempts: w.facts.attempts + 1 } }))
        yield* changed(entry, false)
        const outcome = yield* deps.run(d.gate).pipe(
          Effect.map((result) => ({ ok: true as const, result })),
          Effect.catchTag("CheckError", (error) => Effect.succeed({ ok: false as const, message: error.message })),
          Effect.ensuring(Effect.sync(() => { entry.checking = false })),
        )
        if (!outcome.ok) return { status: "failed", failure: outcome.message }
        const at = yield* Clock.currentTimeMillis
        const { result } = outcome
        const passed = result.code === 0 && !result.killed
        yield* update(entry, (w) => ({ ...w, facts: { ...w.facts, lastCheckedAt: at, lastResult: { code: result.code, killed: result.killed } } }))
        if (passed && d.kind === "until") return { status: "succeeded" }
        if (passed) {
          yield* Deferred.succeed(entry.firstCheck, undefined)
          const failed = yield* deliverTick(entry)
          if (failed) return failed
          continue
        }
        yield* update(entry, (w) => ({
          ...w,
          facts: d.kind === "until" ? { ...w.facts, nextDueAt: at + d.intervalMs } : advanceAfterTick(w.facts, d.intervalMs, at),
        }))
        yield* changed(entry)
        yield* Deferred.succeed(entry.firstCheck, undefined)
      }
    })

  const runWatch = (entry: Entry) =>
    Effect.gen(function* () {
      const d = entry.watch.definition
      const deadline =
        d.expiresAt === undefined
          ? Effect.never
          : Clock.currentTimeMillis.pipe(
              Effect.flatMap((now) => Effect.sleep(Math.max(0, (d.expiresAt ?? now) - now))),
              Effect.as<Ending>({ status: d.kind === "until" ? "timedOut" : "expired" }),
            )
      const ending = yield* Effect.raceFirst(loop(entry), deadline)
      yield* finish(entry, ending.status, ending.failure)
    })

  const launch = (entry: Entry) => FiberMap.run(fibers, entry.key, runWatch(entry)).pipe(Effect.asVoid)
  const halt = (entry: Entry) => FiberMap.remove(fibers, entry.key)

  // ---- queries --------------------------------------------------------------------------

  const list = (sessionID: string): readonly Watch[] =>
    [...entries.values()]
      .map((entry) => entry.watch)
      .filter((watch) => watch.sessionID === sessionID)
      .sort((a, b) => Number(b.facts.status === "running") - Number(a.facts.status === "running") || b.facts.startedAt - a.facts.startedAt)

  const get = (sessionID: string, id: string) =>
    Effect.suspend(() => {
      const entry = entries.get(keyOf(sessionID, id))
      return entry
        ? Effect.succeed(entry)
        : Effect.fail(new UntilError({ message: `Unknown until watch in this session: ${id}. Run until action=list to see watch IDs.` }))
    })

  const phase = (watch: Watch): Phase | undefined => {
    const entry = entries.get(keyOf(watch.sessionID, watch.id))
    if (!entry || watch.facts.status !== "running") return undefined
    if (entry.checking) return "checking"
    if (watch.delivery) return watch.delivery.state === "queued" ? "queued" : "delivering"
    return "sleeping"
  }

  const prune = (sessionID: string) =>
    Effect.forEach(
      list(sessionID)
        .filter((w) => w.facts.status !== "running" && w.notice?.state !== "pending")
        .sort((a, b) => (b.facts.finishedAt ?? 0) - (a.facts.finishedAt ?? 0))
        .slice(MAX_FINISHED_PER_SESSION)
        .flatMap((w) => Option.toArray(Option.fromUndefinedOr(entries.get(keyOf(sessionID, w.id))))),
      forget,
      { discard: true },
    )

  // ---- operations -----------------------------------------------------------------------

  /** Starts a watch owned by (and waking) `sessionID`; `origin` names the subagent that armed it. */
  const start = (sessionID: string, definition: Definition, options: { readonly inline?: boolean; readonly origin?: Origin } = {}) =>
    Effect.gen(function* () {
      if (list(sessionID).filter((w) => w.facts.status === "running").length >= MAX_ACTIVE_PER_SESSION) {
        return yield* new UntilError({ message: `At most ${MAX_ACTIVE_PER_SESSION} active until watches per session; cancel one first` })
      }
      let id = watchID()
      while (entries.has(keyOf(sessionID, id))) id = watchID()
      const now = yield* Clock.currentTimeMillis
      const entry = newEntry(
        {
          v: 1, id, sessionID, location: deps.location, ...(options.origin ? { origin: options.origin } : {}),
          definition, facts: initialFacts(definition, now),
        },
        options.inline ?? false,
      )
      entries.set(entry.key, entry)
      yield* save(entry)
      yield* deps.telemetry.record(sessionID, startedEvent(entry.watch, false))
      yield* launch(entry)
      yield* emit({ type: "changed", sessionID })
      return entry.watch
    })

  /** Waits for the first check or the end (at most `ms`); after this the watch wakes normally. */
  const settleInline = (sessionID: string, id: string, ms: Duration.Input) =>
    Effect.gen(function* () {
      const entry = yield* get(sessionID, id)
      yield* Deferred.await(entry.firstCheck).pipe(Effect.timeoutOption(ms))
      entry.inline = false
      return { watch: entry.watch, answered: entry.watch.facts.status !== "running" }
    })

  const cancel = (sessionID: string, id: string) =>
    Effect.gen(function* () {
      const entry = yield* get(sessionID, id)
      yield* halt(entry)
      yield* finish(entry, "cancelled")
      return entry.watch
    })

  const complete = (sessionID: string, id: string) =>
    Effect.gen(function* () {
      const entry = yield* get(sessionID, id)
      if (entry.watch.definition.kind !== "recurring") {
        return yield* new UntilError({ message: `Watch ${id} is not recurring; use action=cancel to stop it` })
      }
      yield* halt(entry)
      yield* finish(entry, "completed")
      return entry.watch
    })

  /** Session events: deletion forgets watches; inbox and execution events settle recurring wakes. Esc never cancels. */
  const handleEvent = (event: unknown) =>
    Effect.gen(function* () {
      const parsed = decodeEvent(event)
      if (Option.isNone(parsed)) return
      const { type, data } = parsed.value
      const owned = [...entries.values()].filter((entry) => entry.watch.sessionID === data.sessionID)
      if (type === "session.deleted") {
        yield* Effect.forEach(owned, (entry) => halt(entry).pipe(Effect.andThen(forget(entry))), { discard: true })
        return
      }
      for (const entry of owned) {
        const delivery = entry.watch.delivery
        if (!delivery || entry.watch.facts.status !== "running") continue
        if (type === "session.inbox.delivered" && data.inboxID === delivery.messageID && delivery.state === "queued") {
          yield* update(entry, (w) => ({ ...w, delivery: { ...delivery, state: "delivering" } }))
          yield* changed(entry)
          // Belt and braces for a missed execution-end event.
          yield* settleWhenIdle(entry)
        } else if (type === "session.inbox.cancelled" && data.inboxID === delivery.messageID) {
          yield* settle(entry, delivery.messageID)
        } else if (EXECUTION_END.has(type) && delivery.state === "delivering") {
          yield* settle(entry, delivery.messageID)
        }
      }
    })

  /** After an event-stream gap, in-flight recurring wakes settle when their session is idle. */
  const resync = Effect.suspend(() =>
    Effect.forEach(
      [...entries.values()].filter((entry) => entry.watch.delivery && entry.watch.facts.status === "running"),
      settleWhenIdle,
      { discard: true },
    ),
  )

  /**
   * Loads this location's watches. Running ones resume (an in-flight recurring wake is resent
   * with its own ID), and pending wakes are resent. A `start` watch whose deadline passed while
   * nothing owned it wakes the agent as timed out; a recurrence that expired meanwhile finishes
   * silently. Watches of deleted sessions are forgotten.
   */
  const restore = Effect.gen(function* () {
    const stored: Watch[] = []
    let after: string | undefined
    do {
      const page = yield* deps.storage.scan({ prefix: STORAGE_PREFIX, ...(after ? { after } : {}), limit: 500 })
      for (const { value } of page.entries) {
        const watch = decode(value)
        if (Option.isSome(watch) && sameLocation(watch.value.location, deps.location)) stored.push(watch.value)
      }
      after = page.next
    } while (after)
    const gone = new Set<string>()
    const relevant = new Set(stored.filter((w) => w.facts.status === "running" || w.notice?.state === "pending").map((w) => w.sessionID))
    for (const sessionID of relevant) if ((yield* deps.sessionExists(sessionID)) === false) gone.add(sessionID)
    const resumed = new Map<string, number>()
    const now = yield* Clock.currentTimeMillis
    for (const watch of stored) {
      if (entries.has(keyOf(watch.sessionID, watch.id))) continue
      const entry = newEntry(watch)
      entries.set(entry.key, entry)
      if (gone.has(watch.sessionID)) {
        yield* forget(entry)
        continue
      }
      const d = watch.definition
      if (watch.facts.status !== "running") {
        if (watch.notice?.state === "pending") yield* Effect.forkIn(sendNotice(entry), scope)
        continue
      }
      if (d.expiresAt !== undefined && d.expiresAt <= now) {
        if (d.kind === "until") {
          yield* finish(entry, "timedOut")
          continue
        }
        yield* update(entry, ({ delivery: _, ...w }) => ({ ...w, facts: { ...w.facts, status: "expired", finishedAt: d.expiresAt } }))
        yield* save(entry)
        yield* finishedEvent(entry.watch, now)
        continue
      }
      yield* update(entry, (w) => ({ ...w, facts: { ...w.facts, reloads: w.facts.reloads + 1 } }))
      yield* save(entry)
      yield* deps.telemetry.record(watch.sessionID, startedEvent(entry.watch, true))
      resumed.set(watch.sessionID, (resumed.get(watch.sessionID) ?? 0) + 1)
      yield* launch(entry)
    }
    for (const [sessionID, count] of resumed) {
      yield* deps.telemetry.record(sessionID, { event: "resumed", count })
      yield* emit({ type: "changed", sessionID })
    }
  })

  return { start, settleInline, list, get, phase, cancel, complete, handleEvent, resync, restore }
})

