import assert from "node:assert/strict"
import test from "node:test"
import { Option, Schema } from "effect"
import {
  ToolInput, StoredWatchJson, TOOL_DESCRIPTION, advanceAfterTick, coalescePastDue, initialFacts, messageID, parseCommand,
  receipt, receiptText, recurringWake, startedText, terminalWake, type Definition, type Facts, type RecurringDefinition, type Watch,
} from "../domain.ts"
import { formatDuration } from "../format.ts"

const context = { cwd: "/repo", now: 1000, isDirectory: (dir: string) => ["/repo", "/repo/sub", "/tmp"].includes(dir) }
const decode = Schema.decodeUnknownSync(ToolInput)
const parse = (input: Record<string, unknown>) => parseCommand(decode(input), context)
const definitionOf = (input: Record<string, unknown>, now = 1000): Definition => {
  const command = parseCommand(decode(input), { ...context, now })
  if (command.action !== "start" && command.action !== "repeat") throw new Error("not a start command")
  return command.definition
}
const watch = (definition: Definition, facts: Partial<Facts> = {}): Watch => ({
  v: 1, id: "abcd1234", sessionID: "ses", location: { directory: "/repo" }, definition, facts: { ...initialFacts(definition, 0), ...facts },
})

test("start parses pi-until parameters with defaults; cwd resolves from the session directory", () => {
  assert.deepEqual(definitionOf({ action: "start", condition: " test -f done " }), {
    kind: "until", label: "condition", wake: "agent", intervalMs: 30_000,
    gate: { command: "test -f done", cwd: "/repo", checkTimeoutMs: 30_000 },
  })
  const full = definitionOf({ action: "start", condition: "true", label: "deploy", cwd: "sub", intervalSeconds: 5, checkTimeoutSeconds: 2, timeoutSeconds: 60, wake: "notify" })
  assert.equal(full.kind, "until")
  if (full.kind !== "until") return
  assert.equal(full.gate.cwd, "/repo/sub")
  assert.equal(full.intervalMs, 5000)
  assert.equal(full.gate.checkTimeoutMs, 2000)
  assert.equal(full.expiresAt, 61_000)
  assert.equal(full.wake, "notify")
})

test("schema and parse errors say exactly what to fix", () => {
  const schemaErrors: Array<[Record<string, unknown>, RegExp]> = [
    [{ action: "start", condition: "x", intervalSeconds: 0 }, /intervalSeconds/],
    [{ action: "start", condition: "x".repeat(4097) }, /condition/],
    [{ action: "nope" }, /action/],
  ]
  for (const [input, error] of schemaErrors) assert.throws(() => decode(input), error, JSON.stringify(input))
  const parseErrors: Array<[Record<string, unknown>, RegExp]> = [
    [{ action: "start" }, /condition is required/],
    [{ action: "start", condition: "x", cwd: "missing" }, /cwd is not a directory: \/repo\/missing/],
    [{ action: "repeat", instruction: "x", quickRef: "y" }, /timeoutSeconds is required/],
    [{ action: "repeat", quickRef: "y", timeoutSeconds: 9 }, /instruction is required/],
    [{ action: "repeat", instruction: "x", quickRef: "y", timeoutSeconds: 9, wake: "notify" }, /repeat always wakes the agent/],
    [{ action: "cancel" }, /id is required/],
  ]
  for (const [input, error] of parseErrors) assert.throws(() => parse(input), error, JSON.stringify(input))
})

test("like pi-until, fields an action does not use are ignored", () => {
  assert.deepEqual(parse({ action: "cancel", id: "w1", label: "x", condition: "y" }), { action: "cancel", id: "w1" })
  assert.deepEqual(parse({ action: "list", id: "w1" }), { action: "list" })
})

test("repeat snapshots the task, gate optional; immediate controls the first wake", () => {
  const definition = definitionOf({
    action: "repeat", instruction: "Review deploy", quickRef: "Release 42", timeoutSeconds: 3600, intervalSeconds: 600,
    contextRefs: [{ label: "Runbook", target: "docs/release.md" }], immediate: true,
  })
  assert.equal(definition.kind, "recurring")
  if (definition.kind !== "recurring") return
  assert.equal(definition.gate, undefined)
  assert.equal(definition.first, "now")
  assert.equal(definition.expiresAt, 3_601_000)
  assert.deepEqual(definition.snapshot.contextRefs, [{ label: "Runbook", target: "docs/release.md" }])
  assert.equal(initialFacts(definition, 1000).nextDueAt, 1000)
  assert.equal(initialFacts({ ...definition, first: "afterInterval" }, 1000).nextDueAt, 601_000)
})

test("cadence stays anchored; ticks that pass during work become missed, never stacked", () => {
  const facts = initialFacts(definitionOf({ action: "start", condition: "x" }, 1000), 1000)
  assert.deepEqual([advanceAfterTick(facts, 100, 1000).nextDueAt, advanceAfterTick(facts, 100, 1000).missedTicks], [1100, 0])
  assert.deepEqual([advanceAfterTick(facts, 100, 1350).nextDueAt, advanceAfterTick(facts, 100, 1350).missedTicks], [1400, 3])
  const later = { ...facts, nextDueAt: 1100 }
  assert.deepEqual([coalescePastDue(later, 100, 1250).nextDueAt, coalescePastDue(later, 100, 1250).missedTicks], [1300, 2])
  assert.equal(coalescePastDue(later, 100, 1050), later)
})

test("message IDs use OpenCode ascending format", () => {
  const ids = [messageID(1_700_000_000_000), messageID(1_700_000_000_000), messageID(1_700_000_000_001)]
  for (const id of ids) assert.match(id, /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
  const [a, b, c] = ids.map((id) => id.slice(4, 16))
  assert.ok(a !== undefined && b !== undefined && c !== undefined && a < b && b < c)
})

test("stored records round-trip; malformed JSON or shapes are rejected at the boundary", () => {
  const w = watch(definitionOf({ action: "start", condition: "x" }))
  const encoded = Schema.encodeSync(StoredWatchJson)(w)
  assert.equal(typeof encoded, "string")
  assert.deepEqual(Schema.decodeUnknownSync(StoredWatchJson)(encoded), w)
  for (const bad of ["{", JSON.stringify({ ...w, definition: { kind: "until" } }), JSON.stringify({ ...w, facts: { ...w.facts, status: "nope" } })]) {
    assert.equal(Option.isNone(Schema.decodeUnknownOption(StoredWatchJson)(bad)), true)
  }
})

test("wakes: success tells the agent to verify before acting; notify wakes nobody", () => {
  const definition = definitionOf({ action: "start", condition: "test -f done", label: "build" })
  const wake = terminalWake(watch(definition, { status: "succeeded", attempts: 3, finishedAt: 134_000 }), 134_000)
  assert.match(wake?.text ?? "", /^The condition was true when checked\. Before acting, confirm/)
  assert.match(wake?.text ?? "", /until watch abcd1234: succeeded\nKind: until\nLabel: build\nCondition: test -f done/)
  assert.equal(wake?.description, "until · build · condition met after 3 checks (2m14s)")
  assert.match(terminalWake(watch(definition, { status: "timedOut", attempts: 1, finishedAt: 5 }), 5)?.text ?? "", /timed out/)
  assert.equal(terminalWake(watch(definition, { status: "cancelled", finishedAt: 5 }), 5), undefined)
  if (definition.kind === "until") assert.equal(terminalWake(watch({ ...definition, wake: "notify" }, { status: "succeeded", finishedAt: 5 }), 5), undefined)
})

test("subagent watches name who armed them", () => {
  const definition = definitionOf({ action: "start", condition: "x", label: "CI" })
  const armed = { ...watch(definition, { status: "succeeded", finishedAt: 5 }), origin: { sessionID: "ses_child", title: "CI watcher" } }
  assert.match(terminalWake(armed, 5)?.text ?? "", /Armed by: subagent session ses_child \(CI watcher\)/)
  assert.match(terminalWake(armed, 5)?.description ?? "", /from subagent$/)
  assert.match(startedText({ ...armed, facts: { ...armed.facts, status: "running" } }), /The main session \(ses\) wakes, not you/)
})

test("recurring packets carry instruction, receipt, context and control lines", () => {
  const definition = definitionOf(
    { action: "repeat", instruction: "Fix failures", quickRef: "Release 42", timeoutSeconds: 60, contextRefs: [{ label: "Runbook", target: "docs/r.md" }] },
    0,
  )
  if (definition.kind !== "recurring") throw new Error("expected recurring")
  const recurring = (facts: Partial<Facts>) => watch(definition, facts) as Watch & { readonly definition: RecurringDefinition }
  const tick = recurringWake(recurring({ deliveries: 2, missedTicks: 1, nextDueAt: 90_000 }), 30_000)
  assert.match(tick.text, /# Recurring follow-up\n\n## Instruction\nFix failures\n\n## Quick reference\nRelease 42/)
  assert.match(tick.text, /- Delivery: 2\n- Missed ticks: 1/)
  assert.match(tick.text, /- Runbook: `docs\/r.md`/)
  assert.match(tick.text, /action=complete` and `id=abcd1234`/)
  assert.equal(tick.description, "until · recurring follow-up · wake 2 (1 missed)")
  const expired = terminalWake(recurring({ status: "expired", deliveries: 4, finishedAt: 60_000 }), 60_000)
  assert.match(expired?.text ?? "", /Do not continue its task unless the user asks/)
  assert.equal(terminalWake(recurring({ status: "completed", finishedAt: 5 }), 5), undefined)
})

test("receipts and started text are agent-actionable", () => {
  const definition = definitionOf({ action: "start", condition: "true", timeoutSeconds: 60 })
  const r = receipt(watch(definition, { lastResult: { code: 124, killed: true }, attempts: 2 }), 5000)
  assert.match(receiptText(r), /Last exit code: 124\nLast check ran past checkTimeoutSeconds/)
  assert.match(startedText(watch(definition)), /Checks now, then every 30s, until .*do not poll\./)
  assert.equal(formatDuration(3_725_000), "1h02m")
})

test("tool contract: pi-until parameter names, guidance in the description", () => {
  assert.deepEqual(Object.keys(ToolInput.fields).sort(), [
    "action", "checkTimeoutSeconds", "condition", "contextRefs", "cwd", "id", "immediate", "instruction", "intervalSeconds", "label", "quickRef", "timeoutSeconds", "wake",
  ])
  for (const phrase of ["Never block a turn", "fail-closed", "Run list before re-arming", "survive Esc", "Requires instruction, quickRef and timeoutSeconds", "In a subagent, watches belong to the main session"]) {
    assert.ok(TOOL_DESCRIPTION.includes(phrase), phrase)
  }
})
