// Pure `until` domain: the tool contract, parsing at the boundary, the stored-watch schema,
// cadence math, receipts and the agent-facing wake packets. Mirrors pi-until
// (joelhooks/pi-until@e2eceb0) semantics.
import { createHash, randomBytes } from "node:crypto"
import { homedir } from "node:os"
import path from "node:path"
import { Data, Schema } from "effect"
import { formatDuration } from "./format.ts"

export const DEFAULT_INTERVAL_SECONDS = 30
export const DEFAULT_CHECK_TIMEOUT_SECONDS = 30
export const MAX_ACTIVE_PER_SESSION = 32
export const MAX_FINISHED_PER_SESSION = 50
/** `start` waits this long for the first check, so an already-true condition answers inline. */
export const FIRST_CHECK_WAIT_MS = 3000
export const MAX_CONDITION = 4096

/** An expected, agent-actionable failure; its message says what to fix. */
export class UntilError extends Data.TaggedError("UntilError")<{ readonly message: string }> {}

// ---- tool contract ------------------------------------------------------------------------

export const ACTIONS = ["start", "repeat", "list", "status", "complete", "cancel"] as const

export const TOOL_DESCRIPTION = [
  "Background watches owned by this session. Never block a turn with sleep or polling loops: arm a watch, then end your turn or keep working.",
  "- start: run a side-effect-free shell `condition` now, then every intervalSeconds (default 30). Exit 0 means true. When it is true, times out, or fails, this session is woken with a receipt (wake=notify only shows the user a toast). If it is already true within a few seconds, the result comes back inline and no watch remains.",
  "- repeat: wake this session every intervalSeconds with a fixed `instruction` until timeoutSeconds. Requires instruction, quickRef and timeoutSeconds (absolute lifetime). Optional `condition` gates each tick. Call complete when the goal is achieved (a finished turn is not completion), cancel to stop without success.",
  "- list / status / cancel / complete take an `id`. Run list before re-arming: watches survive Esc, plugin reloads and server restarts, so re-arming by hand creates duplicates.",
  "- In a subagent, watches belong to the main session, which is woken instead of you: put the watch ID and what it waits for in your result, then finish.",
  "Write fail-closed conditions: exit 0 must prove fresh, positive evidence from this run (`grep -qx DONE out.txt`, `test -s result.json`), never the absence of something (`! pgrep job`) or a pipeline whose last command succeeds on nothing (`grep -c`). Do not arm a watch in the same tool batch that writes or resets what it reads; the first check runs immediately.",
  "A wake proves the condition was true when checked, not that work remains: confirm the result is unhandled before acting. Before re-arming a result watch, record consumed item IDs or a cursor and make the new condition reject handled results.",
  "Keep labels, instructions and contextRefs short and secret-free. Use a durable scheduler for work that must outlive this session.",
].join("\n")

const text = (max: number) => Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(max))
const seconds = (minimum: number, maximum: number) => Schema.Finite.check(Schema.isBetween({ minimum, maximum }))

export const ContextRef = Schema.Struct({
  label: text(120).annotate({ description: "Pointer name." }),
  target: text(2048).annotate({ description: "Path, URL or identifier." }),
})

/** Flat like pi-until's: models handle one object with optional fields better than a union. */
export const ToolInput = Schema.Struct({
  action: Schema.Literals(ACTIONS).annotate({ description: "start | repeat | list | status | complete | cancel." }),
  condition: Schema.optionalKey(text(MAX_CONDITION)).annotate({
    description: "Side-effect-free shell command; exit 0 means true. Required for start; optional gate for repeat.",
  }),
  label: Schema.optionalKey(text(120)).annotate({ description: "Short human label shown in the UI and receipts. No secrets." }),
  cwd: Schema.optionalKey(text(4096)).annotate({
    description: "Directory for the condition. Defaults to the session directory; relative paths and ~ resolve from there.",
  }),
  intervalSeconds: Schema.optionalKey(seconds(1, 86_400)).annotate({
    description: `Seconds between checks or recurring wakes. Default ${DEFAULT_INTERVAL_SECONDS}.`,
  }),
  checkTimeoutSeconds: Schema.optionalKey(seconds(1, 3600)).annotate({
    description: `Limit for one check; a check that runs over counts as false. Default ${DEFAULT_CHECK_TIMEOUT_SECONDS}.`,
  }),
  timeoutSeconds: Schema.optionalKey(seconds(1, 2_000_000)).annotate({
    description: "Overall deadline from now. Optional for start (the agent is woken on timeout); required for repeat.",
  }),
  wake: Schema.optionalKey(Schema.Literals(["agent", "notify"])).annotate({
    description: "start only. agent (default) wakes this session; notify only shows the user a toast.",
  }),
  id: Schema.optionalKey(text(64)).annotate({ description: "Watch ID for status, complete and cancel." }),
  instruction: Schema.optionalKey(text(20_000)).annotate({ description: "repeat: the task given to this session on every wake." }),
  quickRef: Schema.optionalKey(text(500)).annotate({ description: "repeat: short human reference for the recurring task." }),
  contextRefs: Schema.optionalKey(Schema.Array(ContextRef).check(Schema.isMaxLength(16))).annotate({
    description: "repeat: opaque { label, target } pointers passed through unresolved.",
  }),
  immediate: Schema.optionalKey(Schema.Boolean).annotate({
    description: "repeat: true wakes after this turn; otherwise the first wake follows one interval.",
  }),
})
export type ToolInput = typeof ToolInput.Type

// ---- stored watch -----------------------------------------------------------------------

export const Gate = Schema.Struct({ command: text(MAX_CONDITION), cwd: Schema.String, checkTimeoutMs: Schema.Finite })
export type Gate = typeof Gate.Type

const UntilDefinition = Schema.Struct({
  kind: Schema.Literal("until"),
  label: Schema.String,
  wake: Schema.Literals(["agent", "notify"]),
  intervalMs: Schema.Finite,
  gate: Gate,
  expiresAt: Schema.optionalKey(Schema.Finite),
})
const RecurringDefinition = Schema.Struct({
  kind: Schema.Literal("recurring"),
  label: Schema.String,
  intervalMs: Schema.Finite,
  expiresAt: Schema.Finite,
  first: Schema.Literals(["now", "afterInterval"]),
  gate: Schema.optionalKey(Gate),
  snapshot: Schema.Struct({
    instruction: Schema.String,
    quickRef: Schema.String,
    contextRefs: Schema.Array(ContextRef),
    capturedAt: Schema.Finite,
  }),
})
export const Definition = Schema.Union([UntilDefinition, RecurringDefinition])
export type Definition = typeof Definition.Type
export type UntilDefinition = typeof UntilDefinition.Type
export type RecurringDefinition = typeof RecurringDefinition.Type

/** `timedOut` ends a `start` watch at its deadline; `expired` ends a `repeat` watch. */
export const Status = Schema.Literals(["running", "succeeded", "timedOut", "completed", "expired", "cancelled", "failed"])
export type Status = typeof Status.Type
export type FinalStatus = Exclude<Status, "running">

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const Facts = Schema.Struct({
  status: Status,
  startedAt: Schema.Finite,
  nextDueAt: Schema.Finite,
  attempts: count,
  deliveries: count,
  missedTicks: count,
  reloads: count,
  finishedAt: Schema.optionalKey(Schema.Finite),
  lastCheckedAt: Schema.optionalKey(Schema.Finite),
  lastResult: Schema.optionalKey(Schema.Struct({ code: Schema.Int, killed: Schema.Boolean })),
  failure: Schema.optionalKey(Schema.String),
})
export type Facts = typeof Facts.Type

const Wake = { messageID: Schema.String, text: Schema.String, description: Schema.String }
/** A recurring wake in flight: persisted with its payload so a restart resends it, never skips or stacks it. */
export const Delivery = Schema.Struct({ ...Wake, state: Schema.Literals(["queued", "delivering"]) })
export type Delivery = typeof Delivery.Type
/** The terminal wake. Only a pending one keeps its payload (to resend); sent ones drop it. */
export const Notice = Schema.Union([
  Schema.Struct({ ...Wake, state: Schema.Literals(["pending", "failed"]) }),
  Schema.Struct({ messageID: Schema.String, state: Schema.Literal("sent") }),
])
export type Notice = typeof Notice.Type
export const Origin = Schema.Struct({ sessionID: Schema.String, title: Schema.optionalKey(Schema.String) })
export type Origin = typeof Origin.Type
export const Location = Schema.Struct({ directory: Schema.String, workspaceID: Schema.optionalKey(Schema.String) })
export type Location = typeof Location.Type

export const StoredWatch = Schema.Struct({
  v: Schema.Literal(1),
  id: Schema.String,
  sessionID: Schema.String,
  location: Location,
  origin: Schema.optionalKey(Origin),
  definition: Definition,
  facts: Facts,
  delivery: Schema.optionalKey(Delivery),
  notice: Schema.optionalKey(Notice),
})
export type Watch = typeof StoredWatch.Type
/** Plugin storage holds JSON strings; decoding them is the boundary that drops malformed records. */
export const StoredWatchJson = Schema.fromJsonString(StoredWatch)

// ---- parsing ----------------------------------------------------------------------------

export type Command =
  | { readonly action: "start"; readonly definition: UntilDefinition }
  | { readonly action: "repeat"; readonly definition: RecurringDefinition }
  | { readonly action: "list" }
  | { readonly action: "status" | "complete" | "cancel"; readonly id: string }

export interface ParseContext {
  readonly cwd: string
  readonly now: number
  readonly isDirectory: (dir: string) => boolean
}

function resolveCwd(context: ParseContext, value: string | undefined): string {
  const raw = value ?? "."
  const expanded = raw === "~" ? homedir() : raw.startsWith("~/") ? path.join(homedir(), raw.slice(2)) : raw
  const dir = path.resolve(context.cwd, expanded)
  if (!context.isDirectory(dir)) throw new UntilError({ message: `cwd is not a directory: ${dir}` })
  return dir
}

function gate(input: ToolInput, context: ParseContext): Gate | undefined {
  const command = input.condition?.trim()
  if (!command) return undefined
  return {
    command,
    cwd: resolveCwd(context, input.cwd),
    checkTimeoutMs: (input.checkTimeoutSeconds ?? DEFAULT_CHECK_TIMEOUT_SECONDS) * 1000,
  }
}

const trimmed = (value: string | undefined) => value?.trim() || undefined

/**
 * Turns decoded tool input into a command. Like pi-until, fields an action does not use are
 * ignored. Throws `UntilError` for cross-field rules the schema cannot express.
 */
export function parseCommand(input: ToolInput, context: ParseContext): Command {
  const action = input.action
  if (action === "list") return { action }
  if (action === "status" || action === "complete" || action === "cancel") {
    const id = trimmed(input.id)
    if (!id) throw new UntilError({ message: `id is required for action=${action}` })
    return { action, id }
  }
  const intervalMs = (input.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000
  const label = trimmed(input.label)
  const timeout = input.timeoutSeconds
  if (action === "start") {
    const condition = gate(input, context)
    if (!condition) throw new UntilError({ message: "condition is required for action=start" })
    return {
      action,
      definition: {
        kind: "until",
        label: label ?? "condition",
        wake: input.wake ?? "agent",
        intervalMs,
        gate: condition,
        ...(timeout === undefined ? {} : { expiresAt: context.now + timeout * 1000 }),
      },
    }
  }
  const instruction = trimmed(input.instruction)
  if (!instruction) throw new UntilError({ message: "instruction is required for action=repeat" })
  const quickRef = trimmed(input.quickRef)
  if (!quickRef) throw new UntilError({ message: "quickRef is required for action=repeat" })
  if (timeout === undefined) throw new UntilError({ message: "timeoutSeconds is required for action=repeat" })
  if (input.wake === "notify") throw new UntilError({ message: "repeat always wakes the agent; wake=notify is not supported" })
  const contextRefs = (input.contextRefs ?? []).map((ref) => ({ label: ref.label.trim(), target: ref.target.trim() }))
  if (contextRefs.some((ref) => !ref.label || !ref.target)) {
    throw new UntilError({ message: "contextRefs require non-empty label and target values" })
  }
  const condition = gate(input, context)
  return {
    action,
    definition: {
      kind: "recurring",
      label: label ?? "recurring follow-up",
      intervalMs,
      expiresAt: context.now + timeout * 1000,
      first: input.immediate === true ? "now" : "afterInterval",
      ...(condition ? { gate: condition } : {}),
      snapshot: { instruction, quickRef, contextRefs, capturedAt: context.now },
    },
  }
}

// ---- cadence ----------------------------------------------------------------------------

export const wakeOf = (definition: Definition) => (definition.kind === "until" ? definition.wake : "agent")

export function initialFacts(definition: Definition, now: number): Facts {
  return {
    status: "running",
    startedAt: now,
    attempts: 0,
    deliveries: 0,
    missedTicks: 0,
    reloads: 0,
    nextDueAt: definition.kind === "until" || definition.first === "now" ? now : now + definition.intervalMs,
  }
}

const ticksDueThrough = (nextDueAt: number, intervalMs: number, now: number) =>
  nextDueAt > now ? 0 : Math.floor((now - nextDueAt) / intervalMs) + 1

/** Consumes the current recurring tick and coalesces later ticks that are already due into `missedTicks`. */
export function advanceAfterTick(facts: Facts, intervalMs: number, now: number): Facts {
  const next = facts.nextDueAt + intervalMs
  const missed = ticksDueThrough(next, intervalMs, now)
  return { ...facts, missedTicks: facts.missedTicks + missed, nextDueAt: next + missed * intervalMs }
}

/** Coalesces ticks that became due while a delivered follow-up was running. */
export function coalescePastDue(facts: Facts, intervalMs: number, now: number): Facts {
  const missed = ticksDueThrough(facts.nextDueAt, intervalMs, now)
  return missed === 0 ? facts : { ...facts, missedTicks: facts.missedTicks + missed, nextDueAt: facts.nextDueAt + missed * intervalMs }
}

// ---- identifiers ------------------------------------------------------------------------

export const watchID = () => randomBytes(4).toString("hex")

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let lastMessageTime = 0
let messageCounter = 0
/** An ascending `msg_` ID in OpenCode's own format; persisted before sending so retries stay idempotent. */
export function messageID(now: number): string {
  if (now !== lastMessageTime) {
    lastMessageTime = now
    messageCounter = 0
  }
  messageCounter++
  const value = BigInt(now) * 0x1000n + BigInt(messageCounter)
  const time = Array.from({ length: 6 }, (_, i) => Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0")).join("")
  return `msg_${time}${Array.from(randomBytes(14), (byte) => BASE62[byte % 62]).join("")}`
}

/** Groups conditions in telemetry without writing any fragment of the command. */
export const hashCondition = (command: string) => createHash("sha256").update(command.trim()).digest("hex").slice(0, 12)

// ---- receipts and packets ---------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString()
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Agent/RPC view of a watch. Includes the condition (the agent wrote it); never check output. */
export interface Receipt {
  readonly id: string
  readonly kind: Definition["kind"]
  readonly label: string
  readonly status: Status
  readonly wake: "agent" | "notify"
  readonly armedBy?: Origin
  readonly condition?: string
  readonly cwd?: string
  readonly intervalSeconds: number
  readonly attempts: number
  readonly deliveries: number
  readonly missedTicks: number
  readonly reloads: number
  readonly startedAt: string
  readonly elapsed: string
  readonly nextDueAt?: string
  readonly expiresAt?: string
  readonly finishedAt?: string
  readonly lastExitCode?: number
  readonly lastCheckKilled?: boolean
  readonly quickRef?: string
  readonly deliveryPending?: boolean
  readonly failure?: string
  readonly wakeFailed?: boolean
}

export function receipt(watch: Watch, now: number): Receipt {
  const { definition: d, facts: f } = watch
  return {
    id: watch.id,
    kind: d.kind,
    label: d.label,
    status: f.status,
    wake: wakeOf(d),
    ...(watch.origin ? { armedBy: watch.origin } : {}),
    ...(d.gate ? { condition: d.gate.command, cwd: d.gate.cwd } : {}),
    intervalSeconds: d.intervalMs / 1000,
    attempts: f.attempts,
    deliveries: f.deliveries,
    missedTicks: f.missedTicks,
    reloads: f.reloads,
    startedAt: iso(f.startedAt),
    elapsed: formatDuration((f.finishedAt ?? now) - f.startedAt),
    ...(f.status === "running" ? { nextDueAt: iso(f.nextDueAt) } : {}),
    ...(d.expiresAt === undefined ? {} : { expiresAt: iso(d.expiresAt) }),
    ...(f.finishedAt === undefined ? {} : { finishedAt: iso(f.finishedAt) }),
    ...(f.lastResult ? { lastExitCode: f.lastResult.code, lastCheckKilled: f.lastResult.killed } : {}),
    ...(d.kind === "recurring" ? { quickRef: d.snapshot.quickRef, deliveryPending: watch.delivery !== undefined } : {}),
    ...(f.failure ? { failure: f.failure } : {}),
    ...(watch.notice?.state === "failed" ? { wakeFailed: true } : {}),
  }
}

const armedBy = (origin: Origin) => `subagent session ${origin.sessionID}${origin.title ? ` (${origin.title})` : ""}`

export function receiptText(r: Receipt): string {
  const lines = [`until watch ${r.id}: ${r.status}`, `Kind: ${r.kind}`, `Label: ${r.label}`]
  if (r.armedBy) lines.push(`Armed by: ${armedBy(r.armedBy)}`)
  if (r.condition) lines.push(`Condition: ${r.condition}`, `Cwd: ${r.cwd}`)
  lines.push(`Checks: ${r.attempts}`, `Elapsed: ${r.elapsed}`)
  if (r.kind === "recurring") {
    lines.push(`Deliveries: ${r.deliveries}`, `Delivery pending: ${r.deliveryPending ? "yes" : "no"}`, `Missed ticks: ${r.missedTicks}`, `Quick ref: ${r.quickRef}`)
  }
  if (r.nextDueAt) lines.push(`Next due: ${r.nextDueAt}`)
  if (r.expiresAt) lines.push(`Expires: ${r.expiresAt}`)
  if (r.reloads > 0) lines.push(`Survived reloads: ${r.reloads}`)
  if (r.lastExitCode !== undefined) lines.push(`Last exit code: ${r.lastExitCode}`)
  if (r.lastCheckKilled) lines.push("Last check ran past checkTimeoutSeconds and was terminated (counted as false).")
  if (r.failure) lines.push(`Failure: ${r.failure}`)
  if (r.wakeFailed) lines.push("Wake delivery failed; the session was not resumed for this result.")
  return lines.join("\n")
}

export function listText(receipts: readonly Receipt[]): string {
  if (!receipts.length) return "No until watches in this session."
  return receipts
    .map((r) => [
      r.id, r.status, r.kind, r.label, `checks=${r.attempts}`,
      ...(r.kind === "recurring" ? [`wakes=${r.deliveries}`] : []),
      ...(r.armedBy ? [`by=${r.armedBy.sessionID}`] : []),
    ].join("\t"))
    .join("\n")
}

export function startedText(watch: Watch): string {
  const { definition: d, facts: f } = watch
  const expires = d.expiresAt === undefined ? "" : `, until ${iso(d.expiresAt)}`
  const sub = watch.origin !== undefined
  const woken = sub ? `The main session (${watch.sessionID}) wakes, not you,` : "This session wakes"
  const timing =
    d.kind === "until"
      ? `Checks now, then every ${d.intervalMs / 1000}s${expires || " with no deadline"}. ${
          d.wake === "agent"
            ? `${woken} with a receipt when it is true, times out, or fails: ${sub ? "put the watch ID and what it waits for in your result, then finish" : "end your turn or keep working; do not poll"}.`
            : "The user gets a toast when it finishes; nobody is woken."
        }`
      : `First wake ${d.first === "now" ? "after this turn" : `at ${iso(f.nextDueAt)}`}, then every ${d.intervalMs / 1000}s${expires}. ${
          sub ? `Wakes go to the main session (${watch.sessionID}); put the watch ID in your result.` : `Call until action=complete id=${watch.id} when the goal is achieved.`
        }`
  return `Started until ${d.kind === "until" ? "watch" : "recurring watch"} ${watch.id} (${d.label}). ${timing}`
}

const WAKE_INSTRUCTIONS: Partial<Record<Status, string>> = {
  succeeded:
    "The condition was true when checked. Before acting, confirm the task still needs work and the matching result is unhandled. If the task is finished, stop. Do not act on a handled result again. Re-arm only for continuing work, after recording consumed item IDs or a source cursor and excluding handled results.",
  timedOut: "The watch timed out before the condition became true. Inspect the receipt and decide what to do next.",
  failed: "The watch failed. Inspect the receipt and decide what to do next.",
}

const contextLines = (d: RecurringDefinition) =>
  d.snapshot.contextRefs.length ? ["", "## Context", ...d.snapshot.contextRefs.map((ref) => `- ${ref.label}: \`${ref.target}\``)] : []

export interface WakeText {
  /** Goes to the model. */
  readonly text: string
  /** The one-line transcript notice. */
  readonly description: string
}

/** The terminal wake for a finished watch, or undefined when nobody is woken. */
export function terminalWake(watch: Watch, now: number): WakeText | undefined {
  const { definition: d, facts: f } = watch
  const from = watch.origin ? " · from subagent" : ""
  const notice = (what: string) => `until · ${d.label} · ${what}${from}`
  if (d.kind === "until") {
    const instruction = WAKE_INSTRUCTIONS[f.status]
    if (d.wake !== "agent" || !instruction) return undefined
    const r = receipt(watch, now)
    const what =
      f.status === "succeeded"
        ? `condition met after ${plural(f.attempts, "check")} (${r.elapsed})`
        : f.status === "timedOut"
          ? `timed out after ${plural(f.attempts, "check")}`
          : "failed"
    return { text: `${instruction}\n\n${receiptText(r)}`, description: notice(what) }
  }
  if (f.status === "expired") {
    return {
      description: notice(`expired after ${plural(f.deliveries, "wake")}`),
      text: [
        "# Recurring follow-up expired", "", "This recurrence is no longer active. Do not continue its task unless the user asks.", "",
        "## Quick reference", d.snapshot.quickRef, "", "## Receipt", `- Watch: \`${watch.id}\``, "- Status: expired",
        `- Deliveries: ${f.deliveries}`, `- Missed ticks: ${f.missedTicks}`, `- Expired: ${iso(d.expiresAt)}`, `- Survived reloads: ${f.reloads}`,
        ...contextLines(d),
      ].join("\n"),
    }
  }
  if (f.status === "failed") {
    return {
      description: notice("failed"),
      text: `The recurring watch failed. Inspect this receipt before deciding what to do.\n\n${receiptText(receipt(watch, now))}`,
    }
  }
  return undefined
}

/** One recurring wake. `watch.facts` are already advanced past this delivery. */
export function recurringWake(watch: Watch & { readonly definition: RecurringDefinition }, deliveredAt: number): WakeText {
  const { definition: d, facts: f } = watch
  const missed = f.missedTicks ? ` (${f.missedTicks} missed)` : ""
  return {
    description: `until · ${d.label} · wake ${f.deliveries}${missed}${watch.origin ? " · from subagent" : ""}`,
    text: [
      "# Recurring follow-up", "", "## Instruction", d.snapshot.instruction, "", "## Quick reference", d.snapshot.quickRef, "",
      "## Receipt", `- Watch: \`${watch.id}\``, ...(watch.origin ? [`- Armed by: ${armedBy(watch.origin)}`] : []),
      `- Delivery: ${f.deliveries}`, `- Missed ticks: ${f.missedTicks}`, `- Delivered: ${iso(deliveredAt)}`,
      `- Next due: ${iso(f.nextDueAt)}`, `- Expires: ${iso(d.expiresAt)}`, `- Survived reloads: ${f.reloads}`,
      ...contextLines(d),
      "", "## Control",
      `Call \`until\` with \`action=complete\` and \`id=${watch.id}\` when the goal is achieved.`,
      `Call \`until\` with \`action=cancel\` and \`id=${watch.id}\` to abort it.`,
    ].join("\n"),
  }
}

export interface Toast {
  readonly title: string
  readonly message: string
  readonly variant: "success" | "warning" | "error"
}

/** The user-facing toast for a finished `wake=notify` watch. */
export function notifyToast(watch: Watch): Toast | undefined {
  const { definition: d, facts: f } = watch
  if (d.kind !== "until" || d.wake !== "notify" || !WAKE_INSTRUCTIONS[f.status]) return undefined
  return {
    title: `until · ${d.label}`,
    message: f.status === "succeeded" ? "condition met" : f.status === "timedOut" ? "timed out" : `failed${f.failure ? `: ${f.failure}` : ""}`,
    variant: f.status === "succeeded" ? "success" : f.status === "timedOut" ? "warning" : "error",
  }
}
