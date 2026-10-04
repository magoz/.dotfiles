import assert from "node:assert/strict"
import test from "node:test"
import { Deferred, Effect, Fiber, Option } from "effect"
import { CheckError } from "../check.ts"
import { advance, harness, location, memoryStorage, run, settle, START, stored } from "./harness.ts"

const no = { code: 1, killed: false }
const yes = { code: 0, killed: false }

test("start checks immediately, polls on cadence, wakes exactly once with a receipt when true", () =>
  run(Effect.gen(function* () {
    const h = yield* harness({ results: [no, no, yes] })
    const watch = yield* h.start({ action: "start", condition: "test -f done", label: "build", intervalSeconds: 10 })
    yield* settle
    assert.equal(h.script.calls.length, 1)
    assert.deepEqual(h.script.calls[0], { command: "test -f done", cwd: "/repo", checkTimeoutMs: 30_000 })
    yield* advance(9_999)
    assert.equal(h.script.calls.length, 1)
    yield* advance(1)
    assert.equal(h.script.calls.length, 2)
    yield* advance(10_000)
    const { watch: done } = yield* h.engine.get("ses", watch.id)
    assert.equal(done.facts.status, "succeeded")
    assert.equal(done.facts.attempts, 3)
    assert.equal(h.wakes.length, 1)
    const [wake] = h.wakes
    assert.ok(wake)
    assert.equal(wake.sessionID, "ses")
    assert.match(wake.id, /^msg_/)
    assert.equal(wake.description, "until · build · condition met after 3 checks (20s)")
    assert.match(wake.text, /confirm the task still needs work[\s\S]*until watch .*: succeeded/)
    assert.deepEqual(wake.metadata, { source: "until", watchID: watch.id, kind: "until", status: "succeeded" })
    yield* advance(60_000)
    assert.equal(h.script.calls.length, 3)
    assert.equal(h.wakes.length, 1)
    const saved = Option.getOrThrow(stored(h.store, watch.id))
    assert.equal(saved.facts.status, "succeeded")
    assert.deepEqual(saved.notice, { messageID: wake.id, state: "sent" })
    assert.deepEqual(h.telemetry.map((e) => e.event), ["started", "finished"])
    assert.ok(!JSON.stringify(h.telemetry).includes("test -f done"))
  })))

test("a check that runs past its timeout counts as false and polling continues", () =>
  run(Effect.gen(function* () {
    const h = yield* harness({ results: [{ code: 1, killed: true }, yes] })
    const watch = yield* h.start({ action: "start", condition: "slow", intervalSeconds: 5 })
    yield* settle
    assert.equal(watch.facts.status, "running")
    assert.deepEqual((yield* h.engine.get("ses", watch.id)).watch.facts.lastResult, { code: 1, killed: true })
    yield* advance(5_000)
    assert.equal((yield* h.engine.get("ses", watch.id)).watch.facts.status, "succeeded")
  })))

test("timeout and spawn failure wake the agent instead of stopping silently", () =>
  run(Effect.gen(function* () {
    const h = yield* harness({ results: [no, no, no, new CheckError({ message: "could not start condition: ENOENT" })] })
    const timed = yield* h.start({ action: "start", condition: "never", timeoutSeconds: 65, label: "deploy" })
    yield* advance(65_000)
    assert.equal((yield* h.engine.get("ses", timed.id)).watch.facts.status, "timedOut")
    assert.equal(h.wakes.length, 1)
    assert.match(h.wakes[0]?.text ?? "", /^The watch timed out/)
    assert.equal(h.wakes[0]?.description, "until · deploy · timed out after 3 checks")
    const broken = yield* h.start({ action: "start", condition: "x" })
    yield* settle
    const failed = (yield* h.engine.get("ses", broken.id)).watch
    assert.equal(failed.facts.status, "failed")
    assert.equal(failed.facts.failure, "could not start condition: ENOENT")
    assert.match(h.wakes[1]?.text ?? "", /^The watch failed[\s\S]*Failure: could not start condition: ENOENT/)
  })))

test("Esc and other session events never cancel a watch; deletion forgets it", () =>
  run(Effect.gen(function* () {
    const h = yield* harness()
    const watch = yield* h.start({ action: "start", condition: "x", intervalSeconds: 5 })
    yield* settle
    yield* h.engine.handleEvent({ type: "session.execution.interrupted", data: { sessionID: "ses", reason: "user" } })
    yield* advance(5_000)
    assert.equal((yield* h.engine.get("ses", watch.id)).watch.facts.status, "running")
    assert.equal(h.script.calls.length, 2)
    yield* h.engine.handleEvent({ type: "session.deleted", data: { sessionID: "ses" } })
    yield* advance(60_000)
    assert.equal(h.script.calls.length, 2)
    assert.deepEqual(h.engine.list("ses"), [])
    assert.equal(h.store.data.size, 0)
  })))

test("cancel during a check interrupts it and wakes nobody; unknown IDs explain the fix", () =>
  run(Effect.gen(function* () {
    const interrupted = yield* Deferred.make<void>()
    const h = yield* harness({ results: [Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)))] })
    const watch = yield* h.start({ action: "start", condition: "x" })
    yield* settle
    assert.equal(h.engine.phase((yield* h.engine.get("ses", watch.id)).watch), "checking")
    yield* h.engine.cancel("ses", watch.id)
    yield* Deferred.await(interrupted)
    assert.equal((yield* h.engine.get("ses", watch.id)).watch.facts.status, "cancelled")
    assert.equal(h.wakes.length, 0)
    const unknown = yield* Effect.flip(h.engine.cancel("ses", "nope"))
    assert.match(unknown.message, /Unknown until watch in this session: nope\. Run until action=list/)
    const notRecurring = yield* Effect.flip(h.engine.complete("ses", watch.id))
    assert.match(notRecurring.message, /not recurring/)
  })))

test("wake=notify toasts the user and never wakes the agent", () =>
  run(Effect.gen(function* () {
    const h = yield* harness({ results: [yes] })
    yield* h.start({ action: "start", condition: "x", wake: "notify", label: "tests" })
    yield* settle
    assert.equal(h.wakes.length, 0)
    assert.deepEqual(h.events.find((e) => e.type === "notify"), {
      type: "notify", sessionID: "ses", title: "until · tests", message: "condition met", variant: "success",
    })
  })))

test("inline start: an already-true first check answers the tool call and wakes nobody", () =>
  run(Effect.gen(function* () {
    const slow = yield* Deferred.make<{ code: number; killed: boolean }>()
    const h = yield* harness({ results: [yes, Deferred.await(slow)] })
    const watch = yield* h.start({ action: "start", condition: "true" }, { inline: true })
    const answer = yield* h.engine.settleInline("ses", watch.id, 3_000)
    assert.equal(answer.answered, true)
    assert.equal(h.wakes.length, 0)
    assert.equal(answer.watch.notice, undefined)
    const later = yield* h.start({ action: "start", condition: "slow" }, { inline: true })
    const pending = yield* Effect.forkChild(h.engine.settleInline("ses", later.id, 3_000))
    yield* advance(3_000)
    assert.equal((yield* Fiber.join(pending)).answered, false)
    yield* Deferred.succeed(slow, yes)
    yield* settle
    assert.equal((yield* h.engine.get("ses", later.id)).watch.facts.status, "succeeded")
    assert.equal(h.wakes.length, 1, "past the inline window, the result wakes the agent")
  })))

test("recurring wakes are serialized: ticks during a running follow-up become missed ticks", () =>
  run(Effect.gen(function* () {
    const h = yield* harness()
    const watch = yield* h.start({ action: "repeat", instruction: "Review deploy", quickRef: "R42", intervalSeconds: 60, timeoutSeconds: 3600 })
    yield* advance(59_999)
    assert.equal(h.wakes.length, 0)
    yield* advance(1)
    assert.equal(h.wakes.length, 1)
    assert.match(h.wakes[0]?.text ?? "", /## Instruction\nReview deploy/)
    const current = () => h.engine.get("ses", watch.id).pipe(Effect.map((entry) => entry.watch))
    assert.equal(h.engine.phase(yield* current()), "queued")
    yield* h.engine.handleEvent({ type: "session.inbox.delivered", data: { sessionID: "ses", inboxID: h.wakes[0]?.id } })
    assert.equal(h.engine.phase(yield* current()), "delivering")
    yield* advance(150_000)
    assert.equal(h.wakes.length, 1, "no stacked wakes while the follow-up runs")
    yield* h.engine.handleEvent({ type: "session.execution.succeeded", data: { sessionID: "ses" } })
    yield* settle
    assert.equal((yield* current()).facts.missedTicks, 2)
    yield* advance(60_000)
    assert.equal(h.wakes.length, 2)
    assert.match(h.wakes[1]?.text ?? "", /- Delivery: 2\n- Missed ticks: 2/)
    assert.notEqual(h.wakes[1]?.id, h.wakes[0]?.id)
    yield* h.engine.complete("ses", watch.id)
    assert.equal((yield* current()).facts.status, "completed")
    assert.equal(h.wakes.length, 2)
  })))

test("recurring gate skips ticks without waking; expiry delivers the expired packet", () =>
  run(Effect.gen(function* () {
    const h = yield* harness({ results: [no] })
    const watch = yield* h.start({ action: "repeat", instruction: "x", quickRef: "gated", condition: "test -f go", intervalSeconds: 60, timeoutSeconds: 200, immediate: true })
    yield* advance(180_000)
    assert.equal(h.script.calls.length, 4)
    assert.equal(h.wakes.length, 0)
    yield* advance(20_000)
    assert.equal((yield* h.engine.get("ses", watch.id)).watch.facts.status, "expired")
    assert.equal(h.wakes.length, 1)
    assert.match(h.wakes[0]?.text ?? "", /^# Recurring follow-up expired/)
  })))

test("wake admission retries with the same message ID; exhausted retries are visible", () =>
  run(Effect.gen(function* () {
    let attempts = 0
    let down = false
    const ids: string[] = []
    const h = yield* harness({
      results: [yes],
      synthetic: (input) =>
        Effect.suspend((): Effect.Effect<void, string> => {
          ids.push(input.id)
          return down || ++attempts < 3 ? Effect.fail("transport") : Effect.void
        }),
    })
    const watch = yield* h.start({ action: "start", condition: "x" })
    yield* advance(100)
    assert.equal(ids.length, 3)
    assert.equal(new Set(ids).size, 1)
    assert.equal((yield* h.engine.get("ses", watch.id)).watch.notice?.state, "sent")
    down = true
    const lost = yield* h.start({ action: "start", condition: "x" })
    yield* advance(100)
    const notice = (yield* h.engine.get("ses", lost.id)).watch.notice
    assert.equal(notice?.state, "failed")
    assert.ok(notice && "text" in notice && notice.text.length > 0)
  })))

test("restore resumes this location only, wakes timeouts missed while down, resends pending wakes, drops corrupt records", () =>
  run(Effect.gen(function* () {
    const store = memoryStorage()
    const ids = yield* Effect.scoped(Effect.gen(function* () {
      const first = yield* harness({ storage: store, results: [Effect.never] })
      const running = yield* first.start({ action: "start", condition: "x", timeoutSeconds: 600 })
      const expiring = yield* first.start({ action: "start", condition: "y", timeoutSeconds: 10 })
      yield* settle
      return { running: running.id, expiring: expiring.id }
    }))
    assert.equal(Option.getOrThrow(stored(store, ids.running)).facts.status, "running", "unload never cancels")
    const pendingID = "msg_000000000000pendingpending"
    const base = { v: 1, sessionID: "ses", location }
    store.data.set("watch/ses/feedface", JSON.stringify({
      ...base, id: "feedface",
      definition: { kind: "until", label: "old", wake: "agent", intervalMs: 1000, gate: { command: "x", cwd: "/repo", checkTimeoutMs: 1000 } },
      facts: { status: "succeeded", startedAt: 0, finishedAt: 1, attempts: 1, deliveries: 0, missedTicks: 0, reloads: 0, nextDueAt: 0 },
      notice: { messageID: pendingID, state: "pending", text: "wake", description: "until · old" },
    }))
    const other = JSON.parse(String(store.data.get(`watch/ses/${ids.running}`)))
    store.data.set("watch/other/cafebabe", JSON.stringify({ ...other, id: "cafebabe", sessionID: "other", location: { directory: "/elsewhere" } }))
    store.data.set("watch/ses/corrupt0", JSON.stringify({ ...base, id: "corrupt0", definition: { kind: "until" }, facts: { status: "running" } }))
    store.data.set("watch/ses/notjson0", "{")

    yield* advance(20_000)
    const second = yield* harness({ storage: store, results: [no] })
    yield* second.engine.restore
    yield* settle
    const restored = (yield* second.engine.get("ses", ids.running)).watch
    assert.equal(restored.facts.status, "running")
    assert.equal(restored.facts.reloads, 1)
    assert.equal(second.script.calls.length, 1, "the restored watch keeps checking")
    assert.equal((yield* second.engine.get("ses", ids.expiring)).watch.facts.status, "timedOut")
    for (const id of ["corrupt0", "notjson0"]) assert.equal(Option.isNone(Option.fromUndefinedOr(second.engine.list("ses").find((w) => w.id === id))), true)
    assert.equal(second.engine.list("other").length, 0)
    const byWatch = new Map(second.wakes.map((w) => [String(w.metadata.watchID), w]))
    assert.equal(byWatch.get("feedface")?.id, pendingID, "the pending wake is resent with its own ID")
    assert.match(byWatch.get(ids.expiring)?.text ?? "", /^The watch timed out/, "an agent waiting on a deadline that passed while down is told")
    assert.equal(second.wakes.length, 2)
    assert.deepEqual(second.telemetry.filter((e) => e.event === "resumed"), [{ sessionID: "ses", event: "resumed", count: 1 }])
  })))

test("restore drops watches of sessions that no longer exist", () =>
  run(Effect.gen(function* () {
    const store = memoryStorage()
    const id = yield* Effect.scoped(harness({ storage: store }).pipe(Effect.flatMap((h) => h.start({ action: "start", condition: "x" })), Effect.map((w) => w.id)))
    const second = yield* harness({ storage: store, sessionExists: () => Effect.succeed(false) })
    yield* second.engine.restore
    assert.equal(store.data.has(`watch/ses/${id}`), false)
  })))

test("a wake admitted while unloading is saved as sent, so the next generation does not resend it", () =>
  run(Effect.gen(function* () {
    const admit = yield* Deferred.make<void>()
    const store = memoryStorage()
    const id = yield* Effect.scoped(Effect.gen(function* () {
      const h = yield* harness({ storage: store, results: [yes], synthetic: () => Deferred.await(admit) })
      const watch = yield* h.start({ action: "start", condition: "x" })
      yield* settle
      yield* Deferred.succeed(admit, undefined)
      return watch.id
    }))
    assert.equal(Option.getOrThrow(stored(store, id)).notice.state, "sent")
  })))

test("an in-flight recurring wake survives a restart: resent with its ID, settled when idle, never stacked", () =>
  run(Effect.gen(function* () {
    const store = memoryStorage()
    const first = yield* Effect.scoped(Effect.gen(function* () {
      const h = yield* harness({ storage: store })
      const watch = yield* h.start({ action: "repeat", instruction: "Check", quickRef: "C", intervalSeconds: 60, timeoutSeconds: 3600, immediate: true })
      yield* settle
      return { id: watch.id, wakes: [...h.wakes] }
    }))
    assert.equal(first.wakes.length, 1)
    const saved = Option.getOrThrow(stored(store, first.id))
    assert.equal(saved.delivery.messageID, first.wakes[0]?.id)
    assert.match(saved.delivery.text, /## Instruction\nCheck/)

    const idle = yield* Deferred.make<void>()
    const second = yield* harness({ storage: store, waitIdle: () => Deferred.await(idle) })
    yield* second.engine.restore
    yield* advance(180_000)
    assert.deepEqual(second.wakes.map((w) => w.id), [first.wakes[0]?.id], "resent once with the same ID; no stacked ticks while unsettled")
    yield* Deferred.succeed(idle, undefined)
    yield* settle
    const restored = (yield* second.engine.get("ses", first.id)).watch
    assert.equal(restored.delivery, undefined)
    assert.equal(restored.facts.missedTicks, 3, "ticks due at +60s, +120s and +180s passed while the wake ran")
    yield* advance(60_000)
    assert.equal(second.wakes.length, 2)
  })))

test("per-session limit and bounded history", () =>
  run(Effect.gen(function* () {
    const h = yield* harness()
    for (let i = 0; i < 32; i++) yield* h.start({ action: "start", condition: "x" })
    const full = yield* Effect.flip(h.start({ action: "start", condition: "x" }))
    assert.match(String(full), /At most 32 active/)
    for (const w of h.engine.list("ses")) yield* h.engine.cancel("ses", w.id)
    for (let i = 0; i < 30; i++) {
      const w = yield* h.start({ action: "start", condition: "x" })
      yield* h.engine.cancel("ses", w.id)
    }
    assert.equal(h.engine.list("ses").length, 50)
  })))

void START
