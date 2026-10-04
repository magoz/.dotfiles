import assert from "node:assert/strict"
import test from "node:test"
import { Effect, Exit, Fiber, Scope } from "effect"
import { TestClock } from "effect/testing"
import { makeBridge } from "../bridge.ts"
import type { Destination, Outcome, ResolvedInput } from "../contract.ts"

const ROOT = "ses_root"
const client = { clientID: "client", rootID: ROOT }
const input: ResolvedInput = { branch: "feat/task" }
const spec = { sessionID: ROOT, rootID: ROOT, cwd: "/repo", input }
const destination: Destination = {
  source: "/repo", branch: "feat/task", base: "abc123", path: "/worktrees/task",
  workspaceId: "workspace", paneId: "pane", agentName: "task", agentKind: "opencode", warnings: [],
}

const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(TestClock.setTime(100).pipe(Effect.andThen(program), Effect.scoped, Effect.provide(TestClock.layer())))
const settle = Effect.gen(function* () {
  for (let i = 0; i < 10; i++) yield* Effect.yieldNow
})
const failure = (exit: Exit.Exit<unknown, { readonly message: string }>) =>
  Exit.isFailure(exit) ? exit.cause.reasons.map((reason) => (reason._tag === "Fail" ? reason.error.message : reason._tag)).join() : "success"

test("requires one exact live root, claims once, validates completion correlation", () =>
  run(Effect.gen(function* () {
    const bridge = yield* makeBridge()
    assert.match(failure(yield* Effect.exit(bridge.request(spec, 1000))), /Exactly one/)
    yield* bridge.pulse({ ...client, rootID: "other" })
    assert.match(failure(yield* Effect.exit(bridge.request(spec, 1000))), /Exactly one/)
    yield* bridge.pulse(client)
    const pending = yield* Effect.forkChild(bridge.request(spec, 1000))
    yield* settle
    const claim = (yield* bridge.pulse(client)).request
    assert.ok(claim)
    assert.equal((yield* bridge.pulse(client)).request, null, "a claim is never reissued")
    const ready: Outcome = { status: "ready", destination, sourceRetained: true }
    const complete = { ...client, id: claim.id, outcome: ready }
    assert.equal((yield* bridge.complete({ ...complete, clientID: "wrong" })).acknowledged, false)
    const wrongBranch = yield* Effect.exit(bridge.complete({ ...complete, outcome: { status: "ready", destination: { ...destination, branch: "wrong" }, sourceRetained: true } }))
    assert.match(failure(wrongBranch), /branch/)
    assert.equal((yield* bridge.complete(complete)).acknowledged, true)
    assert.equal((yield* Fiber.join(pending)).status, "ready")
    assert.equal((yield* bridge.complete(complete)).acknowledged, false)
  })))

test("a second client cancels in-flight work and ambiguity fails closed", () =>
  run(Effect.gen(function* () {
    const bridge = yield* makeBridge()
    yield* bridge.pulse(client)
    const pending = yield* Effect.forkChild(bridge.request(spec, 1000))
    yield* settle
    yield* bridge.pulse(client)
    yield* bridge.pulse({ ...client, clientID: "second" })
    assert.match(failure(yield* Fiber.await(pending)), /ambiguous/)
    assert.match(failure(yield* Effect.exit(bridge.request(spec, 1000))), /Exactly one/)
  })))

test("lease expiry, release, interruption events and unload cancel only current requests", () =>
  run(Effect.gen(function* () {
    const bridge = yield* makeBridge({ leaseMs: 100 })
    yield* bridge.pulse(client)
    let pending = yield* Effect.forkChild(bridge.request(spec, 10_000))
    yield* settle
    yield* TestClock.adjust(101)
    yield* bridge.sweep
    assert.equal(Exit.isFailure(yield* Fiber.await(pending)), true, "lease expired")

    yield* bridge.pulse(client)
    pending = yield* Effect.forkChild(bridge.request(spec, 10_000))
    yield* settle
    yield* bridge.release(client)
    assert.match(failure(yield* Fiber.await(pending)), /TUI disposed/)

    yield* bridge.pulse(client)
    const now = 100 + 101
    pending = yield* Effect.forkChild(bridge.request(spec, 10_000))
    yield* settle
    yield* bridge.cancelSession(ROOT, now - 1) // an older event cannot poison this operation
    assert.equal(bridge.pending(), 1)
    yield* bridge.cancelSession(ROOT, now)
    assert.match(failure(yield* Fiber.await(pending)), /interrupted or deleted/)
  })))

test("interrupting the waiting call withdraws its claimed request: no late authority", () =>
  run(Effect.gen(function* () {
    const bridge = yield* makeBridge()
    yield* bridge.pulse(client)
    const pending = yield* Effect.forkChild(bridge.request(spec, 10_000))
    yield* settle
    const claim = (yield* bridge.pulse(client)).request
    assert.ok(claim)
    yield* Fiber.interrupt(pending)
    assert.equal((yield* bridge.authorize({ ...client, id: claim.id })).authorized, false)
    assert.deepEqual(yield* bridge.pulse(client), { request: null, active: [] })
  })))

test("expired requests never accept a late outcome", () =>
  run(Effect.gen(function* () {
    const bridge = yield* makeBridge()
    yield* bridge.pulse(client)
    const pending = yield* Effect.forkChild(bridge.request(spec, 1000))
    yield* settle
    const claim = (yield* bridge.pulse(client)).request
    assert.ok(claim)
    yield* TestClock.adjust(1001)
    assert.match(failure(yield* Fiber.await(pending)), /expired/)
    assert.equal((yield* bridge.complete({ ...client, id: claim.id, outcome: { status: "failed", reason: "late" } })).acknowledged, false)
  })))

test("closing the plugin scope fails pending requests and the bridge refuses new ones", () =>
  Effect.runPromise(Effect.gen(function* () {
    const scope = yield* Scope.make()
    const bridge = yield* makeBridge().pipe(Scope.provide(scope))
    yield* bridge.pulse(client)
    const pending = yield* Effect.forkChild(bridge.request(spec, 10_000))
    yield* settle
    yield* Scope.close(scope, Exit.void)
    assert.match(failure(yield* Fiber.await(pending)), /unloaded/)
    assert.match(failure(yield* Effect.exit(bridge.request(spec, 1000))), /unavailable/)
  })))
