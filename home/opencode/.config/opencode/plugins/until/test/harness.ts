// Effect test harness: a TestClock-driven engine with in-memory storage and recorded wakes.
import { Clock, Effect, Option, Schema, type Scope } from "effect"
import { TestClock } from "effect/testing"
import type { StorageScanOptions, StorageScanResult } from "@opencode/plugin/storage"
import type { CheckResult, RunCheck } from "../check.ts"
import { CheckError } from "../check.ts"
import { parseCommand, ToolInput, type Gate } from "../domain.ts"
import { makeEngine, type EngineDeps, type UiEvent, type WakeInput } from "../engine.ts"
import type { TelemetryEvent } from "../telemetry.ts"

export const location = { directory: "/repo" }
export const START = 1_000_000

/** Runs a scoped test program on a TestClock starting at START. */
export const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(
    TestClock.setTime(START).pipe(Effect.andThen(program), Effect.scoped, Effect.provide(TestClock.layer())),
  )

/** Lets forked fibers run without moving the clock. */
export const settle = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) yield* Effect.yieldNow
})
export const advance = (ms: number) => TestClock.adjust(ms).pipe(Effect.andThen(settle))

export type Scripted = CheckResult | CheckError | Effect.Effect<CheckResult, CheckError>

/** A check runner that replays `results` (the last one repeats). */
export function scripted(results: Scripted[]) {
  const calls: Gate[] = []
  const runCheck: RunCheck = (gate) =>
    Effect.suspend(() => {
      calls.push(gate)
      const next = results.length > 1 ? results.shift() : results[0]
      if (next === undefined) return Effect.succeed({ code: 1, killed: false })
      if (next instanceof CheckError) return Effect.fail(next)
      return Effect.isEffect(next) ? next : Effect.succeed(next)
    })
  return { runCheck, calls }
}

export const memoryStorage = (initial: ReadonlyArray<readonly [string, string]> = []) => {
  const data = new Map<string, Schema.Json>(initial)
  const storage: EngineDeps["storage"] = {
    set: (key, value) => Effect.sync(() => { data.set(key, value) }),
    remove: (key) => Effect.sync(() => { data.delete(key) }),
    scan: (options: StorageScanOptions) =>
      Effect.sync((): StorageScanResult => {
        const limit = options.limit ?? 100
        const keys = [...data.keys()].filter((k) => k.startsWith(options.prefix) && (options.after === undefined || k > options.after)).sort()
        const page = keys.slice(0, limit)
        const last = page.at(-1)
        return { entries: page.map((key) => ({ key, value: data.get(key) ?? null })), ...(keys.length > limit && last ? { next: last } : {}) }
      }),
  }
  return { data, storage }
}

export interface HarnessOptions {
  readonly results?: Scripted[]
  readonly synthetic?: (input: WakeInput) => Effect.Effect<unknown, unknown>
  readonly storage?: ReturnType<typeof memoryStorage>
  readonly sessionExists?: (sessionID: string) => Effect.Effect<boolean | undefined>
  readonly waitIdle?: (sessionID: string) => Effect.Effect<unknown, unknown>
}

export const harness = (options: HarnessOptions = {}) =>
  Effect.gen(function* () {
    const script = scripted(options.results ?? [{ code: 1, killed: false }])
    const wakes: WakeInput[] = []
    const events: UiEvent[] = []
    const telemetry: Array<{ readonly sessionID: string } & TelemetryEvent> = []
    const store = options.storage ?? memoryStorage()
    const deps: EngineDeps = {
      location,
      run: script.runCheck,
      synthetic: options.synthetic ?? ((input) => Effect.sync(() => { wakes.push(input) })),
      waitIdle: options.waitIdle ?? (() => Effect.never),
      sessionExists: options.sessionExists ?? (() => Effect.succeed(true)),
      storage: store.storage,
      telemetry: { record: (sessionID, event) => Effect.sync(() => { telemetry.push({ sessionID, ...event }) }) },
      emit: (event) => Effect.sync(() => { events.push(event) }),
      retryDelays: [0, 10, 20],
    }
    const engine = yield* makeEngine(deps)
    const start = (raw: Record<string, unknown>, opts?: Parameters<typeof engine.start>[2]) =>
      Effect.gen(function* () {
        const input = Schema.decodeUnknownSync(ToolInput)(raw)
        const now = yield* Clock.currentTimeMillis
        const command = parseCommand(input, { cwd: "/repo", now, isDirectory: () => true })
        if (command.action !== "start" && command.action !== "repeat") return yield* Effect.die("not a start command")
        return yield* engine.start("ses", command.definition, opts)
      })
    return { engine, start, script, wakes, events, telemetry, store }
  })

export const stored = (store: ReturnType<typeof memoryStorage>, id: string) => {
  const value = store.data.get(`watch/ses/${id}`)
  return typeof value === "string" ? Option.some(JSON.parse(value)) : Option.none()
}

