import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { Effect, Queue, Schema, Stream } from "effect"
import { ToolInput } from "../domain.ts"
import { definition } from "../rpc.ts"
import plugin, { setup, type Host, type SessionLike, type UntilTool } from "../server.ts"
import type { TelemetryEvent } from "../telemetry.ts"
import { advance, location, memoryStorage, run, scripted, settle, type Scripted } from "./harness.ts"

const sessions: Record<string, SessionLike> = {
  ses_root: { id: "ses_root", location },
  ses_child: { id: "ses_child", parentID: "ses_root", location, title: "CI watcher", subpath: "sub" },
  ses_grand: { id: "ses_grand", parentID: "ses_child", location },
  ses_far: { id: "ses_far", location: { directory: "/elsewhere" } },
}

interface Wake { readonly sessionID: string; readonly id: string; readonly text: string; readonly description: string; readonly metadata: Readonly<Record<string, string | number>> }

const fixture = (options: { readonly results?: Scripted[]; readonly storage?: ReturnType<typeof memoryStorage> } = {}) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<unknown>()
    const wakes: Wake[] = []
    const emitted: Array<{ readonly name: string; readonly data: unknown }> = []
    const actions: string[] = []
    const store = options.storage ?? memoryStorage()
    const script = scripted(options.results ?? [{ code: 1, killed: false }])
    let tool: UntilTool | undefined
    const host: Host = {
      location,
      session: {
        get: ({ sessionID }) => {
          const info = sessions[sessionID]
          return info ? Effect.succeed(info) : Effect.fail(new Error(`Session not found: ${sessionID}`))
        },
        synthetic: (input) => Effect.sync(() => { wakes.push(input) }),
        wait: () => Effect.never,
      },
      storage: store.storage,
      event: { subscribe: () => Stream.fromQueue(events) },
      rpc: {
        register: () =>
          Effect.sync(() => {
            return {
              dispose: Effect.void,
              events: { emit: (name: string, data: unknown) => Effect.sync(() => { emitted.push({ name, data }) }) },
            }
          }),
      },
      tool: { transform: (callback) => Effect.sync(() => callback({ add: (value) => { tool = value } })) },
    }
    const { api, execute } = yield* setup(host, {
      run: script.runCheck,
      isDirectory: (dir) => dir === "/repo" || dir === "/repo/sub",
      retryDelays: [0],
      telemetry: {
        enabled: true,
        filePath: "/dev/null",
        record: (_sessionID: string, event: TelemetryEvent) => Effect.sync(() => { if (event.event === "action") actions.push(`${event.source}:${event.action}`) }),
      },
    })
    yield* settle
    if (!tool) return yield* Effect.die("plugin did not register its tool")
    const call = (input: Record<string, unknown>, sessionID = "ses_root") =>
      execute(Schema.decodeUnknownSync(ToolInput)(input), { sessionID }).pipe(
        Effect.map((result) => ({ content: result.content, until: result.metadata?.until })),
      )
    return { tool, rpc: api, call, wakes, emitted, actions, events, script, store }
  })

test("one direct `until` tool: no confirmation, hidden only where shell is denied", async () => {
  assert.equal(plugin.id, "dotfiles-until")
  assert.equal(typeof plugin.effect, "function")
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(pkg.exports["./server"], "./server.ts")
  assert.equal(pkg.exports["./tui"], "./tui.js")
  await run(Effect.gen(function* () {
    const f = yield* fixture()
    assert.equal(f.tool.name, "until")
    assert.deepEqual(f.tool.options, { codemode: false, permission: "shell" })
    const rejected = yield* Effect.promise(async () => f.tool.input["~standard"].validate({ action: "start", intervalSeconds: 0 }))
    assert.ok(rejected.issues?.some((issue) => issue.message === "Expected a value between 1 and 86400"))
    const far = yield* Effect.flip(f.call({ action: "list" }, "ses_far"))
    assert.match(far.message, /does not belong to this plugin location/)
  }))
})

test("start answers inline when already true, otherwise arms a watch and says not to poll", () =>
  run(Effect.gen(function* () {
    const f = yield* fixture({ results: [{ code: 0, killed: false }, { code: 1, killed: false }] })
    const inline = yield* f.call({ action: "start", condition: "test -f done", label: "ready" })
    assert.match(inline.content, /^Condition is already true \(check 1, exit 0\)\. No watch remains: continue now\./)
    assert.equal(inline.until?.status, "succeeded")
    assert.equal(f.wakes.length, 0)
    const armed = yield* f.call({ action: "start", condition: "test -f later", label: "later", intervalSeconds: 10 })
    assert.match(armed.content, /^Started until watch [0-9a-f]{8} \(later\)\. Checks now, then every 10s with no deadline\. .*do not poll\. First check: exit 1\./)
    const id = armed.until?.id
    assert.match((yield* f.call({ action: "list" })).content, new RegExp(`${id}\\trunning\\tuntil\\tlater`))
    assert.match((yield* f.call({ action: "status", id })).content, /Condition: test -f later\nCwd: \/repo/)
    assert.match((yield* f.call({ action: "cancel", id })).content, /: cancelled/)
    const unknown = yield* Effect.flip(f.call({ action: "complete", id: "nope" }))
    assert.equal(unknown._tag, "Tool.Error")
    assert.match(unknown.message, /Unknown until watch in this session: nope/)
    assert.deepEqual(f.actions, ["tool:start", "tool:start", "tool:list", "tool:status", "tool:cancel", "tool:complete"])
  })))

test("Esc does not cancel; deletion does; recurring wakes settle through session events", () =>
  run(Effect.gen(function* () {
    const f = yield* fixture()
    const repeat = yield* f.call({ action: "repeat", instruction: "Check CI", quickRef: "CI", intervalSeconds: 60, timeoutSeconds: 600, immediate: true })
    assert.match(repeat.content, /First wake after this turn, then every 60s/)
    yield* settle
    assert.equal(f.wakes.length, 1)
    yield* Queue.offer(f.events, { type: "session.inbox.delivered", data: { sessionID: "ses_root", inboxID: f.wakes[0]?.id } })
    yield* Queue.offer(f.events, { type: "session.execution.interrupted", data: { sessionID: "ses_root", reason: "user" } })
    yield* settle
    yield* advance(60_000)
    assert.equal(f.wakes.length, 2, "Esc settled the follow-up without cancelling the recurrence")
    yield* Queue.offer(f.events, { type: "session.deleted", data: { sessionID: "ses_root" } })
    yield* settle
    assert.equal((yield* f.call({ action: "list" })).content, "No until watches in this session.")
  })))

test("TUI RPC: views never carry the condition; failures are typed UntilError (registered as until.error)", () =>
  run(Effect.gen(function* () {
    const f = yield* fixture()
    const started = yield* f.rpc.start({ sessionID: "ses_root", condition: "test -f x" })
    assert.equal(started.label, "condition")
    yield* settle
    const { watches } = yield* f.rpc.list({ sessionID: "ses_root" })
    assert.equal(watches.length, 1)
    assert.equal(watches[0]?.phase, "sleeping")
    assert.equal(watches[0]?.attempts, 1)
    assert.ok(!JSON.stringify(watches).includes("test -f x"))
    assert.match((yield* f.rpc.status({ sessionID: "ses_root", id: started.id })).text, /Condition: test -f x/)
    assert.deepEqual(yield* f.rpc.cancel({ sessionID: "ses_root", id: started.id }), { id: started.id, status: "cancelled" })
    const error = yield* Effect.flip(f.rpc.complete({ sessionID: "ses_root", id: started.id }))
    assert.equal(error._tag, "UntilError")
    assert.equal(error.message, `Watch ${started.id} is not recurring; use action=cancel to stop it`)
    assert.ok(f.emitted.some((e) => e.name === "changed"))
  })))

test("a subagent can arm watches: they belong to the main session, which is woken with who armed them", () =>
  run(Effect.gen(function* () {
    const f = yield* fixture()
    const grand = yield* f.call({ action: "start", condition: "test -f done", label: "CI", timeoutSeconds: 60 }, "ses_grand")
    assert.match(grand.content, /The main session \(ses_root\) wakes, not you, .*put the watch ID and what it waits for in your result, then finish\./)
    assert.deepEqual(grand.until?.armedBy, { sessionID: "ses_grand" })
    const child = yield* f.call({ action: "start", condition: "test -f x" }, "ses_child")
    assert.equal(child.until?.cwd, "/repo/sub", "the condition runs in the subagent session directory")
    assert.match((yield* f.call({ action: "list" })).content, new RegExp(`${grand.until?.id}\\trunning.*\\tby=ses_grand`))
    assert.match((yield* f.call({ action: "list" }, "ses_child")).content, new RegExp(grand.until?.id), "any session in the family sees it")
    yield* advance(60_000)
    const wake = f.wakes.find((w) => w.metadata["watchID"] === grand.until?.id)
    assert.equal(wake?.sessionID, "ses_root", "the wake goes to the main session, never the finished subagent")
    assert.match(wake?.text ?? "", /Armed by: subagent session ses_grand/)
    assert.match((yield* f.call({ action: "status", id: child.until?.id })).content, /Armed by: subagent session ses_child \(CI watcher\)/)
    assert.equal((yield* f.rpc.list({ sessionID: "ses_child" })).watches.length, 2)
  })))

test("watches survive a plugin reload: unload persists, the next generation resumes", () =>
  run(Effect.gen(function* () {
    const store = memoryStorage()
    const id = yield* Effect.scoped(
      fixture({ storage: store }).pipe(
        Effect.flatMap((f) => f.call({ action: "start", condition: "x", label: "survivor", timeoutSeconds: 3600 })),
        Effect.map((reply) => reply.until?.id ?? ""),
      ),
    )
    const second = yield* fixture({ storage: store, results: [{ code: 0, killed: false }] })
    yield* advance(30_000)
    assert.equal(second.wakes.length, 1)
    assert.match(second.wakes[0]?.text ?? "", new RegExp(`until watch ${id}: succeeded[\\s\\S]*Survived reloads: 1`))
  })))

test("every schema the host validates is portable, never an Effect schema from this plugin's copy", () => {
  // The host re-runs Effect schema refinements with its own Effect copy and rejects valid
  // values ("Expected an integer"). Standard Schema validation runs in this plugin instead.
  const schemas = [
    ...Object.values(definition.methods).flatMap((method) => [method.input, method.output, ...Object.values("errors" in method ? method.errors : {})]),
    ...Object.values(definition.events).map((event) => event.schema),
  ]
  for (const schema of schemas) {
    assert.equal(Schema.isSchema(schema), false)
    assert.equal(schema["~standard"].vendor, "effect")
  }
  assert.deepEqual(definition.methods.list.output["~standard"].validate({ watches: [{
    id: "a", kind: "until", label: "l", status: "running", wake: "agent", attempts: 1, deliveries: 0, missedTicks: 0, startedAt: 1, nextDueAt: 2,
  }] }), { value: { watches: [{ id: "a", kind: "until", label: "l", status: "running", wake: "agent", attempts: 1, deliveries: 0, missedTicks: 0, startedAt: 1, nextDueAt: 2 }] } })
})
