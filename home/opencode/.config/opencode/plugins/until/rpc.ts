// Server <-> client contract: the TUI, and observers such as Vltra (`waits`, `changed`). The
// server registers it; clients use only its ID, method names and shapes. Expected failures are
// the declared `until.error`, which the TUI receives as `{ type, message }`. Every schema is
// `portable` (see portable.ts): the host validates RPC traffic with these, so they must not be
// Effect schemas from this plugin's copy.
import { Schema } from "effect"
import { Status, wakeOf, type Watch } from "./domain.ts"
import { portable } from "../shared/portable.ts"

const session = { sessionID: Schema.String }
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const errors = { "until.error": portable(Schema.Undefined) }

/** Compact UI view of a watch: labels and counts only, never the condition, cwd or task text. */
export const WatchView = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["until", "recurring"]),
  label: Schema.String,
  status: Status,
  phase: Schema.optionalKey(Schema.Literals(["checking", "sleeping", "queued", "delivering"])),
  wake: Schema.Literals(["agent", "notify"]),
  attempts: count,
  deliveries: count,
  missedTicks: count,
  startedAt: Schema.Finite,
  nextDueAt: Schema.Finite,
  finishedAt: Schema.optionalKey(Schema.Finite),
  expiresAt: Schema.optionalKey(Schema.Finite),
  failure: Schema.optionalKey(Schema.String),
  wakeFailed: Schema.optionalKey(Schema.Boolean),
  fromSubagent: Schema.optionalKey(Schema.Boolean),
})
export type WatchView = typeof WatchView.Type
export type Phase = NonNullable<WatchView["phase"]>

/**
 * A watch an agent waits on: it will wake `sessionID` (the family root, also for watches a
 * subagent armed). Running watches that wake the agent, plus finished ones whose wake is still
 * being delivered; never `wake: notify` ones or a wake that failed. Labels and times only.
 */
export const Wait = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  label: Schema.String,
  /** `until`: woken once, when the condition holds (or at the deadline); `recurring`: every tick. */
  kind: Schema.Literals(["until", "recurring"]),
  startedAt: Schema.Finite,
  /** The next check, or the next recurring wake. */
  nextAt: Schema.Finite,
  expiresAt: Schema.optionalKey(Schema.Finite),
})
export type Wait = typeof Wait.Type

const Waits = { waits: Schema.Array(Wait) }

const Outcome = Schema.Struct({ id: Schema.String, status: Status })

const Session = portable(Schema.Struct(session))
const ById = portable(Schema.Struct({ ...session, id: Schema.String }))
const Text = portable(Schema.Struct({ text: Schema.String }))

export const definition = {
  id: "dotfiles-until",
  methods: {
    list: { input: Session, output: portable(Schema.Struct({ watches: Schema.Array(WatchView) })) },
    start: {
      input: portable(Schema.Struct({ ...session, condition: Schema.String })),
      output: portable(Schema.Struct({ id: Schema.String, label: Schema.String, status: Status })),
      errors,
    },
    cancel: { input: ById, output: portable(Outcome), errors },
    complete: { input: ById, output: portable(Outcome), errors },
    status: { input: ById, output: Text, errors },
    stats: { input: portable(Schema.Struct({})), output: Text, errors },
    /** Every wait in this location (all sessions), for observers loading their view. */
    waits: { input: portable(Schema.Struct({})), output: portable(Schema.Struct(Waits)) },
  },
  events: {
    /** A session's watches changed; `waits` is its waits now (observers replace theirs). */
    changed: { schema: portable(Schema.Struct({ ...session, ...Waits })) },
    notify: {
      schema: portable(
        Schema.Struct({
          ...session,
          title: Schema.String,
          message: Schema.String,
          variant: Schema.Literals(["success", "warning", "error"]),
        }),
      ),
    },
  },
} as const

/** The watch as a wait, when an agent waits on it (see `Wait`). */
export function waitOf(watch: Watch): Wait | undefined {
  const { definition: d, facts: f } = watch
  const delivering = watch.notice?.state === "pending"
  if (wakeOf(d) !== "agent" || (f.status !== "running" && !delivering)) return undefined
  return {
    id: watch.id,
    sessionID: watch.sessionID,
    label: d.label,
    kind: d.kind,
    startedAt: f.startedAt,
    nextAt: f.nextDueAt,
    ...(d.expiresAt === undefined ? {} : { expiresAt: d.expiresAt }),
  }
}

export function view(watch: Watch, phase: Phase | undefined): WatchView {
  const { definition: d, facts: f } = watch
  return {
    id: watch.id,
    kind: d.kind,
    label: d.label,
    status: f.status,
    wake: d.kind === "until" ? d.wake : "agent",
    attempts: f.attempts,
    deliveries: f.deliveries,
    missedTicks: f.missedTicks,
    startedAt: f.startedAt,
    nextDueAt: f.nextDueAt,
    ...(phase ? { phase } : {}),
    ...(f.finishedAt === undefined ? {} : { finishedAt: f.finishedAt }),
    ...(d.expiresAt === undefined ? {} : { expiresAt: d.expiresAt }),
    ...(f.failure ? { failure: f.failure.slice(0, 500) } : {}),
    ...(watch.notice?.state === "failed" ? { wakeFailed: true } : {}),
    ...(watch.origin ? { fromSubagent: true } : {}),
  }
}
