// Server <-> TUI contract. The server registers it; the TUI client uses only its ID and method
// names. Expected failures are the declared `until.error`, which the TUI receives as
// `{ type, message }`. Every schema is `portable` (see portable.ts): the host validates RPC
// traffic with these, so they must not be Effect schemas from this plugin's copy.
import { Schema } from "effect"
import { Status, type Watch } from "./domain.ts"
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
  },
  events: {
    changed: { schema: Session },
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
