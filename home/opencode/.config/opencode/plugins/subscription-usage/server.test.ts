import assert from "node:assert/strict"
import test from "node:test"
import type { RpcHandlers } from "@opencode/plugin/effect/rpc"
import { Effect, Exit, Fiber, Scope } from "effect"
import { definition } from "./rpc.ts"
import plugin, { setup, type Host } from "./server.ts"
import type { Connection, Fetcher } from "./usage.ts"

const settle = Effect.gen(function* () {
  for (let i = 0; i < 5; i++) {
    yield* Effect.yieldNow
    yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)))
  }
})

test("RPC handler interruption cancels the fetch; closing the plugin scope cancels and unregisters", () =>
  Effect.runPromise(Effect.gen(function* () {
    assert.equal(plugin.id, "dotfiles-subscription-usage")
    let handlers: RpcHandlers<typeof definition> | undefined
    let registered = false
    const signals: AbortSignal[] = []
    const fetcher: Fetcher = (_url, init) => {
      if (init.signal) signals.push(init.signal)
      return new Promise(() => {})
    }
    const host: Host<Connection> = {
      location: { directory: "/repo" },
      session: { get: ({ sessionID }) => Effect.succeed({ id: sessionID, location: { directory: "/repo" }, model: { providerID: "openai", id: "model" } }) },
      provider: { get: () => Effect.succeed({ data: { id: "openai", integrationID: "openai" } }) },
      model: { list: () => Effect.succeed({ data: [{ providerID: "openai", id: "model" }] }) },
      integration: {
        connection: {
          active: () => Effect.succeed({ type: "credential", id: "synthetic" }),
          resolve: () => Effect.succeed({ type: "oauth", access: "synthetic-only" }),
        },
      },
      rpc: {
        register: (_definition, value) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              handlers = value
              registered = true
              return { dispose: Effect.void, events: { emit: () => Effect.void } }
            }),
            () => Effect.sync(() => { registered = false }),
          ),
      },
    }
    const scope = yield* Scope.make()
    yield* setup(host, { fetcher }).pipe(Scope.provide(scope))
    const get = handlers?.get
    assert.ok(get && registered)
    const first = yield* Effect.forkChild(get({ sessionID: "ses" }, { error: () => assert.fail("no declared errors") }))
    yield* settle
    yield* Fiber.interrupt(first)
    assert.equal(signals[0]?.aborted, true, "the host interrupting the handler aborts the fetch")
    const second = yield* Effect.forkChild(get({ sessionID: "ses" }, { error: () => assert.fail("no declared errors") }))
    yield* settle
    yield* Scope.close(scope, Exit.void)
    assert.deepEqual(yield* Fiber.join(second), { status: "unavailable", text: "Subscription quota unavailable (requires a supported official connection)." })
    assert.equal(signals[1]?.aborted, true)
    assert.equal(registered, false)
  })))
