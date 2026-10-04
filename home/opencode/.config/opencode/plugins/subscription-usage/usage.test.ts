import assert from "node:assert/strict"
import test from "node:test"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { TestClock } from "effect/testing"
import {
  MAX_RESPONSE_BYTES, STALE_RETENTION_MS, allowedOrigin, format, makeUsage, readBounded, windows,
  type Connection, type Credential, type Fetcher, type Lookups,
} from "./usage.ts"

const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(TestClock.setTime(0).pipe(Effect.andThen(program), Effect.scoped, Effect.provide(TestClock.layer())))
const settle = Effect.gen(function* () {
  for (let i = 0; i < 5; i++) {
    yield* Effect.yieldNow
    yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)))
  }
})
const at = (ms: number) => TestClock.setTime(ms)

test("normalizers never invent unused Grok allowance or expose provider strings", () => {
  assert.deepEqual(windows("xai", { config: { currentPeriod: { type: "SECRET" } } }, 0), [])
  const items = windows("xai", { config: { creditUsagePercent: 75, currentPeriod: { type: "SECRET" } } }, 0)
  assert.equal(format(items, 0), "usage: 25% left · reset unknown")
  assert.equal(windows("anthropic", { five_hour: { utilization: 20 } }, 0)[0]?.left, 80)
  assert.equal(windows("openai", { rate_limit: { primary_window: { used_percent: 30, reset_at: 10 } } }, 0)[0]?.reset, 10_000)
  assert.match(format([{ label: "5h", left: 1, reset: 1 }], 5), /reset pending/)
})

test("zai normalizer parses live CREDIT_LIMIT and legacy TOKENS_LIMIT windows only", () => {
  const live = { code: 200, success: true, data: { level: "max", limits: [
    { type: "CREDIT_LIMIT", unit: 3, percentage: 34, nextResetTime: 1789728449559 },
    { type: "CREDIT_LIMIT", unit: 6, percentage: 39, nextResetTime: 1790237572969 },
    { type: "TIME_LIMIT", unit: 5, number: 1, percentage: 57 },
  ] } }
  assert.deepEqual(windows("zai", live, 0), [
    { label: "5h", left: 66, reset: 1789728449559 },
    { label: "7d", left: 61, reset: 1790237572969 },
  ])
  assert.deepEqual(
    windows("zai", { data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, percentage: 16 }, { type: "TOKENS_LIMIT", unit: 6, percentage: 4, nextResetTime: "not-a-number" }] } }, 0),
    [{ label: "5h", left: 84, reset: undefined }, { label: "7d", left: 96, reset: undefined }],
  )
  const bad: unknown[] = [null, [], {}, { data: null }, { data: {} }, { data: { limits: null } }, { data: { limits: [] } },
    { data: { limits: [{ type: "TIME_LIMIT", unit: 3, percentage: 10 }] } },
    { data: { limits: [{ type: "UNKNOWN_LIMIT", unit: 3, percentage: 10 }] } },
    { data: { limits: [{ type: "CREDIT_LIMIT", unit: 5, percentage: 10 }] } },
    { data: { limits: [{ type: "CREDIT_LIMIT", unit: 3, percentage: "50" }] } },
    { data: { limits: [{ type: "CREDIT_LIMIT", unit: 3, percentage: Number.NaN }] } }]
  for (const payload of bad) assert.deepEqual(windows("zai", payload, 0), [])
  assert.deepEqual(windows("zai", { data: { limits: [{ type: "CREDIT_LIMIT", unit: 6, percentage: -20 }] } }, 0), [{ label: "7d", left: 100, reset: undefined }])
})

test("only supported official origins", () => {
  assert.equal(allowedOrigin("openai", { settings: { baseURL: "https://evil.invalid" } }), false)
  assert.equal(allowedOrigin("openai", { settings: { baseURL: "https://user:secret@api.openai.com" } }), false)
  // The removed direct-login plugin's loopback adapter is no longer an allowed origin.
  assert.equal(allowedOrigin("anthropic", { settings: { baseURL: "http://127.0.0.1:123/random/v1" } }), false)
  assert.equal(allowedOrigin("anthropic", { settings: { baseURL: "https://api.anthropic.com/v1" } }), true)
  assert.equal(allowedOrigin("zai", { settings: { baseURL: "https://proxy.example" } }), false)
  assert.equal(allowedOrigin("zai", { settings: { baseURL: "https://api.z.ai/api/coding/paas/v4" } }), true)
  assert.equal(allowedOrigin("subs-claude", undefined), false)
})

interface Fake extends Lookups<Connection> {
  credential: (connection: Connection) => Effect.Effect<Credential | undefined, unknown>
  session: Lookups["session"]
}

const lookups = (providerID: "openai" | "zai", credential: () => Effect.Effect<Credential | undefined, unknown>): Fake => ({
  location: { directory: "/repo" },
  session: (sessionID) => Effect.succeed({ id: sessionID, location: { directory: "/repo" }, model: { providerID, id: "model" } }),
  provider: () => Effect.succeed({ id: providerID, integrationID: providerID }),
  models: () => Effect.succeed([{ id: "model", providerID }]),
  connection: () => Effect.succeed({ type: "credential", id: "connection" }),
  credential,
})
const oauth = (accountID = "account-a"): Credential => ({ type: "oauth", access: "synthetic-secret", metadata: { accountID } })
const success = (used = 20) => new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: used } } }))

test("OAuth-only fixed endpoint, redirect rejection, cache, no secret output", () =>
  run(Effect.gen(function* () {
    let calls = 0
    const usage = yield* makeUsage(lookups("openai", () => Effect.succeed({ type: "oauth", access: "synthetic-secret" })), {
      fetcher: async (url, init) => {
        calls++
        assert.equal(url, "https://chatgpt.com/backend-api/wham/usage")
        assert.equal(init.redirect, "error")
        assert.ok(init.signal)
        return success()
      },
    })
    const result = yield* usage.get("ses")
    assert.equal(result.status, "available")
    assert.ok(!JSON.stringify(result).includes("synthetic-secret"))
    yield* usage.get("ses")
    assert.equal(calls, 1)
    const keyed = yield* makeUsage(lookups("openai", () => Effect.succeed({ type: "key", key: "synthetic-key" })), {
      fetcher: async () => assert.fail("No API key telemetry"),
    })
    assert.equal((yield* keyed.get("ses")).status, "unavailable")
  })))

test("zai API-key quota uses the official monitor endpoint; auth-kind mismatches never fetch", () =>
  run(Effect.gen(function* () {
    let calls = 0
    const usage = yield* makeUsage(lookups("zai", () => Effect.succeed({ type: "key", key: "synthetic-key" })), {
      fetcher: async (url, init) => {
        calls++
        assert.equal(url, "https://api.z.ai/api/monitor/usage/quota/limit")
        assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic-key")
        return new Response(JSON.stringify({ data: { limits: [
          { type: "CREDIT_LIMIT", unit: 3, percentage: 34, nextResetTime: 3_600_000 },
          { type: "CREDIT_LIMIT", unit: 6, percentage: 39, nextResetTime: 86_400_000 },
        ] } }))
      },
    })
    const result = yield* usage.get("ses")
    assert.equal(result.status, "available")
    assert.match(result.text, /5h: 66% left/)
    assert.match(result.text, /7d: 61% left/)
    yield* usage.get("ses")
    assert.equal(calls, 1)
    const wrongKind = yield* makeUsage(lookups("zai", () => Effect.succeed(oauth())), { fetcher: async () => assert.fail("OAuth cannot read API-key quota") })
    assert.equal((yield* wrongKind.get("ses")).status, "unavailable")
  })))

for (const failure of ["rejection", "timeout", "parse", "body", "oversize", "http", "payload"] as const) {
  test(`same verified identity: success -> expiry -> ${failure} -> cached retry -> refresh`, () =>
    run(Effect.gen(function* () {
      let calls = 0
      const fetcher: Fetcher = async () => {
        calls++
        if (calls !== 2) return success(20 + calls)
        if (failure === "rejection") throw new Error("Synthetic network error with secret")
        if (failure === "timeout") return new Promise<Response>(() => {})
        if (failure === "parse") return new Response("{broken")
        if (failure === "body") return new Response(new ReadableStream({ start(controller) { controller.error(new Error("Synthetic body error")) } }))
        if (failure === "oversize") return new Response("é".repeat(32_769))
        if (failure === "http") return new Response("failure", { status: 503 })
        return new Response("{}")
      }
      const usage = yield* makeUsage(lookups("openai", () => Effect.succeed(oauth())), { fetcher, timeoutMs: 5 })
      const first = yield* usage.get("ses")
      assert.equal(first.status, "available")
      yield* at(300_001)
      const pending = yield* Effect.forkChild(usage.get("ses"))
      yield* settle
      if (failure === "timeout") yield* TestClock.adjust(5)
      const stale = yield* Fiber.join(pending)
      assert.deepEqual(stale, { status: "stale", text: `${first.text}\n(stale)` })
      assert.deepEqual(yield* usage.get("ses"), stale)
      assert.equal(calls, 2)
      yield* at(600_002)
      assert.equal((yield* usage.get("ses")).status, "available")
      assert.equal(calls, 3)
    })))
}

test("stale retention is hard-bounded from success, even through repeated failures and 429 backoff", () =>
  run(Effect.gen(function* () {
    let calls = 0
    const usage = yield* makeUsage(lookups("openai", () => Effect.succeed(oauth())), {
      fetcher: async () => (++calls === 1 ? success() : new Response("", { status: 429, headers: { "retry-after": "999999999" } })),
    })
    assert.equal((yield* usage.get("ses")).status, "available")
    yield* at(300_001)
    assert.equal((yield* usage.get("ses")).status, "stale")
    yield* at(STALE_RETENTION_MS - 1)
    assert.equal((yield* usage.get("ses")).status, "stale")
    yield* at(STALE_RETENTION_MS)
    assert.equal((yield* usage.get("ses")).status, "unavailable")
    assert.equal(calls, 2)
    yield* at(300_001 + 86_400_000)
    assert.equal((yield* usage.get("ses")).status, "unavailable")
    assert.equal(calls, 3)
  })))

test("auth/identity failures never expose cached data; account switch is isolated", () =>
  run(Effect.gen(function* () {
    let calls = 0
    let credential: Credential | Error | undefined = oauth()
    const fake = lookups("openai", () => (credential instanceof Error ? Effect.fail(credential) : Effect.succeed(credential)))
    const original = fake.session
    const usage = yield* makeUsage(fake, { fetcher: async () => { if (++calls > 1) throw new Error("offline"); return success() } })
    assert.equal((yield* usage.get("ses")).status, "available")
    yield* at(300_001)
    for (const invalid of [new Error("auth failed"), undefined, { type: "key", key: "synthetic" } as const, oauth("invalid account")]) {
      credential = invalid
      assert.equal((yield* usage.get("ses")).status, "unavailable")
    }
    credential = oauth()
    fake.session = (sessionID) => original(sessionID).pipe(Effect.map((session) => ({ ...session, location: { directory: "/other" } })))
    assert.equal((yield* usage.get("ses")).status, "unavailable")
    fake.session = original
    credential = oauth("account-b")
    assert.equal((yield* usage.get("ses")).status, "unavailable")
    credential = oauth()
    assert.equal((yield* usage.get("ses")).status, "stale")
    assert.equal(calls, 3)
  })))

test("stream enforces the byte bound while reading and cancels on oversize or interruption", () =>
  run(Effect.gen(function* () {
    let pulls = 0
    let cancelled = 0
    const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(16_384)) }, cancel() { cancelled++ } }, { highWaterMark: 0 })
    assert.equal(Exit.isFailure(yield* Effect.exit(readBounded(new Response(stream)))), true)
    assert.equal(pulls, 5)
    assert.equal(cancelled, 1)
    assert.equal((yield* readBounded(new Response("x".repeat(MAX_RESPONSE_BYTES)))).length, MAX_RESPONSE_BYTES)
    const hanging = new ReadableStream({ cancel() { cancelled++ } })
    const reading = yield* Effect.forkChild(readBounded(new Response(hanging)))
    yield* settle
    yield* Fiber.interrupt(reading)
    assert.equal(cancelled, 2)
  })))

test("caller interruption cancels fetch/body, never returns stale and never poisons the retry", () =>
  run(Effect.gen(function* () {
    let calls = 0
    let cancelled = 0
    let signal: AbortSignal | undefined
    const usage = yield* makeUsage(lookups("openai", () => Effect.succeed(oauth())), {
      fetcher: async (_url, init) => {
        calls++
        signal = init.signal ?? undefined
        return calls !== 2 ? success() : new Response(new ReadableStream({ cancel() { cancelled++ } }))
      },
    })
    yield* usage.get("ses")
    yield* at(300_001)
    const pending = yield* Effect.forkChild(usage.get("ses"))
    yield* settle
    yield* Fiber.interrupt(pending)
    yield* settle
    assert.equal(signal?.aborted ?? false, false, "the response already arrived; its body is cancelled instead")
    assert.equal(cancelled, 1)
    assert.equal((yield* usage.get("ses")).status, "available")
    assert.equal(calls, 3)
  })))

test("a newer same-session request supersedes an older one, which answers unavailable", () =>
  run(Effect.gen(function* () {
    let calls = 0
    const gate = yield* Deferred.make<Credential>()
    let resolve: () => Effect.Effect<Credential | undefined, unknown> = () => Effect.succeed(oauth())
    const usage = yield* makeUsage(lookups("openai", () => resolve()), { fetcher: async () => { calls++; return success() } })
    yield* usage.get("ses")
    yield* at(300_001)
    resolve = () => Deferred.await(gate)
    const old = yield* Effect.forkChild(usage.get("ses"))
    yield* settle
    resolve = () => Effect.fail(new Error("auth failed"))
    assert.equal((yield* usage.get("ses")).status, "unavailable")
    yield* Deferred.succeed(gate, oauth())
    assert.equal((yield* Fiber.join(old)).status, "unavailable")
    assert.equal(calls, 1)
  })))

test("cross-session overlap cannot overwrite a newer snapshot; unload stops late completions", () =>
  run(Effect.gen(function* () {
    let calls = 0
    const gate = Promise.withResolvers<Response>()
    const usage = yield* makeUsage(lookups("openai", () => Effect.succeed(oauth())), { fetcher: async () => (++calls === 1 ? gate.promise : success(70)) })
    const old = yield* Effect.forkChild(usage.get("one"))
    yield* settle
    const newer = yield* usage.get("two")
    assert.match(newer.text, /30% left/)
    gate.resolve(success(10))
    assert.equal((yield* Fiber.join(old)).status, "unavailable")
    assert.deepEqual(yield* usage.get("two"), newer)

    let signal: AbortSignal | undefined
    let cancelled = 0
    const late = Promise.withResolvers<Response>()
    const scope = yield* Scope.make()
    const unloading = yield* makeUsage(lookups("openai", () => Effect.succeed(oauth())), {
      fetcher: async (_url, init) => { signal = init.signal ?? undefined; return late.promise },
    }).pipe(Scope.provide(scope))
    const pending = yield* Effect.forkChild(unloading.get("ses"))
    yield* settle
    yield* Scope.close(scope, Exit.void)
    assert.equal((yield* Fiber.join(pending)).status, "unavailable")
    assert.equal(signal?.aborted, true)
    late.resolve(new Response(new ReadableStream({ cancel() { cancelled++ } })))
    yield* settle
    assert.equal(cancelled, 1, "a late response from a transport that ignored the abort is closed")
  })))
