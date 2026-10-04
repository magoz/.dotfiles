import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { Effect } from "effect"
import { makeTelemetry, readTelemetry, summarize, summaryText, telemetryOptions } from "../telemetry.ts"

test("options follow XDG state and env overrides", () => {
  assert.deepEqual(telemetryOptions({ XDG_STATE_HOME: "/s" }), { enabled: true, filePath: "/s/opencode/until/events.jsonl" })
  assert.deepEqual(telemetryOptions({ OPENCODE_UNTIL_TELEMETRY: "0", OPENCODE_UNTIL_TELEMETRY_FILE: "/x.jsonl" }), { enabled: false, filePath: "/x.jsonl" })
})

test("appends ordered local JSONL, skips foreign lines and summarizes like /until-stats", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "until-telemetry-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, "nested", "events.jsonl")
  await Effect.runPromise(Effect.gen(function* () {
    const sink = yield* makeTelemetry({ enabled: true, filePath })
    const base = { intervalMs: 1000, checkTimeoutMs: 1000, conditionHash: "h", label: "l", fromSubagent: false }
    yield* Effect.all([
      sink.record("a", { event: "started", id: "1", kind: "until", wake: "agent", resumed: false, ...base }),
      sink.record("a", { event: "finished", id: "1", kind: "until", status: "succeeded", wake: "agent", attempts: 3, deliveries: 0, missedTicks: 0, reloads: 0, durationMs: 4000, conditionHash: "h" }),
      sink.record("b", { event: "started", id: "2", kind: "recurring", wake: "agent", resumed: true, ...base }),
      sink.record("b", { event: "resumed", count: 1 }),
      sink.record("b", { event: "action", action: "start", source: "tool" }),
    ], { concurrency: "unbounded", discard: true })
  }))
  const text = await readFile(filePath, "utf8")
  assert.match(text, /^\{"event":"started","id":"1".*"sessionID":"a","v":1\}\n/)
  await import("node:fs/promises").then((fs) => fs.appendFile(filePath, "garbage\n{\"v\":9}\n"))
  const summary = summarize(await Effect.runPromise(readTelemetry(filePath)))
  assert.deepEqual(summary, {
    actions: { "tool:start": 1 }, byStatus: { succeeded: 1 }, byWake: { agent: 1 }, byKind: { until: 1 },
    finished: 1, started: 1, resumed: 1, sessions: 2, medianAttempts: 3, medianDurationMs: 4000,
  })
  assert.match(summaryText(summary, filePath), /Watches started: 1 {2}finished: 1\nBy kind: until=1/)
  const offPath = path.join(dir, "off.jsonl")
  await Effect.runPromise(makeTelemetry({ enabled: false, filePath: offPath }).pipe(Effect.flatMap((off) => off.record("a", { event: "action", action: "list", source: "tool" }))))
  await assert.rejects(readFile(offPath))
})
