// Local usage telemetry: one JSON object per line in a file this user owns. Nothing leaves the
// machine; conditions are written only as a 12-character hash, task text never. Labels are
// written, so keep them safe.
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Clock, Effect, Option, Schema, Semaphore } from "effect"

export const TELEMETRY_VERSION = 1

const Kind = Schema.Literals(["until", "recurring"])
const Wake = Schema.Literals(["agent", "notify"])
const events = {
  started: {
    event: Schema.Literal("started"), id: Schema.String, kind: Kind, label: Schema.String, wake: Wake,
    resumed: Schema.Boolean, fromSubagent: Schema.Boolean, intervalMs: Schema.Finite, checkTimeoutMs: Schema.Finite,
    conditionHash: Schema.String, timeoutMs: Schema.optionalKey(Schema.Finite),
  },
  finished: {
    event: Schema.Literal("finished"), id: Schema.String, kind: Kind, status: Schema.String, wake: Wake,
    attempts: Schema.Finite, deliveries: Schema.Finite, missedTicks: Schema.Finite, reloads: Schema.Finite,
    durationMs: Schema.Finite, conditionHash: Schema.String,
    lastExitCode: Schema.optionalKey(Schema.Finite), lastCheckKilled: Schema.optionalKey(Schema.Boolean),
  },
  resumed: { event: Schema.Literal("resumed"), count: Schema.Finite },
  action: {
    event: Schema.Literal("action"),
    action: Schema.Literals(["start", "repeat", "list", "status", "complete", "cancel"]),
    source: Schema.Literals(["tool", "command"]),
  },
} as const
export const TelemetryEvent = Schema.Union([
  Schema.Struct(events.started), Schema.Struct(events.finished), Schema.Struct(events.resumed), Schema.Struct(events.action),
])
export type TelemetryEvent = typeof TelemetryEvent.Type
const meta = { at: Schema.String, sessionID: Schema.String, v: Schema.Literal(TELEMETRY_VERSION) }
const Line = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ ...events.started, ...meta }), Schema.Struct({ ...events.finished, ...meta }),
    Schema.Struct({ ...events.resumed, ...meta }), Schema.Struct({ ...events.action, ...meta }),
  ]),
)

export interface Telemetry {
  readonly enabled: boolean
  readonly filePath: string
  /** Never fails: telemetry must not break a watch. */
  readonly record: (sessionID: string, event: TelemetryEvent) => Effect.Effect<void>
}

export function telemetryOptions(env: NodeJS.ProcessEnv = process.env) {
  const state = env.XDG_STATE_HOME?.trim() || path.join(homedir(), ".local", "state")
  return {
    enabled: env.OPENCODE_UNTIL_TELEMETRY !== "0",
    filePath: env.OPENCODE_UNTIL_TELEMETRY_FILE?.trim() || path.join(state, "opencode", "until", "events.jsonl"),
  }
}

export const makeTelemetry = (options: { readonly enabled: boolean; readonly filePath: string }) =>
  Effect.gen(function* () {
    // One append at a time keeps lines in event order.
    const lock = yield* Semaphore.make(1)
    const record = (sessionID: string, event: TelemetryEvent): Effect.Effect<void> =>
      options.enabled
        ? Effect.gen(function* () {
            const at = new Date(yield* Clock.currentTimeMillis).toISOString()
            const line = `${JSON.stringify({ ...event, at, sessionID, v: TELEMETRY_VERSION })}\n`
            yield* Effect.tryPromise(async () => {
              await mkdir(path.dirname(options.filePath), { recursive: true })
              await appendFile(options.filePath, line, "utf8")
            }).pipe(Semaphore.withPermits(lock, 1), Effect.ignore)
          })
        : Effect.void
    return { ...options, record } satisfies Telemetry
  })

export const readTelemetry = (filePath: string) =>
  Effect.tryPromise(() => readFile(filePath, "utf8")).pipe(
    Effect.map((text) =>
      text.split("\n").flatMap((line) => (line.trim() ? Option.toArray(Schema.decodeUnknownOption(Line)(line)) : [])),
    ),
    Effect.orElseSucceed(() => []),
  )

type Line = typeof Line.Type

const median = (values: readonly number[]) => {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle] ?? 0
  return sorted.length % 2 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2
}

export function summarize(events: readonly Line[]) {
  const actions: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  const byWake: Record<string, number> = {}
  const byKind: Record<string, number> = {}
  const sessions = new Set<string>()
  const attempts: number[] = []
  const durations: number[] = []
  const bump = (tally: Record<string, number>, key: string) => {
    tally[key] = (tally[key] ?? 0) + 1
  }
  let started = 0
  let finished = 0
  let resumed = 0
  for (const event of events) {
    sessions.add(event.sessionID)
    switch (event.event) {
      case "started":
        if (!event.resumed) {
          started++
          bump(byWake, event.wake)
          bump(byKind, event.kind)
        }
        break
      case "finished":
        finished++
        bump(byStatus, event.status)
        attempts.push(event.attempts)
        durations.push(event.durationMs)
        break
      case "resumed":
        resumed += event.count
        break
      case "action":
        bump(actions, `${event.source}:${event.action}`)
        break
    }
  }
  return {
    actions, byStatus, byWake, byKind, finished, started, resumed,
    sessions: sessions.size, medianAttempts: median(attempts), medianDurationMs: median(durations),
  }
}

const duration = (ms: number | undefined) => {
  if (ms === undefined) return "n/a"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}
const tally = (values: Record<string, number>) =>
  Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join(" ") || "none"

export function summaryText(summary: ReturnType<typeof summarize>, filePath: string): string {
  return [
    `until stats (${filePath})`,
    `Sessions: ${summary.sessions}`,
    `Watches started: ${summary.started}  finished: ${summary.finished}`,
    `By kind: ${tally(summary.byKind)}`,
    `By status: ${tally(summary.byStatus)}`,
    `By wake: ${tally(summary.byWake)}`,
    `Median checks: ${summary.medianAttempts ?? "n/a"}  median duration: ${duration(summary.medianDurationMs)}`,
    `Restored after restart: ${summary.resumed}`,
    `Actions: ${tally(summary.actions)}`,
  ].join("\n")
}
