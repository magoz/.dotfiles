import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Exit, Scope } from "effect";
import plugin, { GATEWAY_ORIGIN_ENV, SEMANTIC_HOOKS } from "./server.ts";
import { ANTHROPIC_GATEWAY_PROVIDERS } from "./shaping.ts";

// A fake `ctx.session` whose registrations live in the plugin scope, like the host's.
function fakeSession(fail) {
  const hooks = [];
  return {
    hooks,
    session: {
      hook: (name, handler, options) =>
        name === fail
          ? Effect.die(new Error("boom"))
          : Effect.acquireRelease(
              Effect.sync(() => {
                const entry = { name, handler, options, disposed: false };
                hooks.push(entry);
                return entry;
              }),
              (entry) => Effect.sync(() => { entry.disposed = true; }),
            ),
    },
  };
}

/** Loads the plugin in a fresh scope; `close` unloads it. */
async function load(ctx) {
  const scope = Effect.runSync(Scope.make());
  const exit = await Effect.runPromise(Effect.exit(plugin.effect(ctx).pipe(Scope.provide(scope))));
  return { exit, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}

test("registers provider-scoped http and semantic hooks; unloading removes them", async () => {
  assert.equal(plugin.id, "magoz.subs-claude-gateway");
  assert.deepEqual([...ANTHROPIC_GATEWAY_PROVIDERS], ["subs-claude"]);
  const { hooks, session } = fakeSession();
  const loaded = await load({ session });
  assert.equal(Exit.isSuccess(loaded.exit), true);
  assert.deepEqual(
    hooks.map((hook) => [hook.name, hook.options]),
    ["http.request", ...SEMANTIC_HOOKS].map((name) => [name, { providerID: "subs-claude" }]),
  );
  await loaded.close();
  assert.ok(hooks.every((hook) => hook.disposed));
});

test("setup fails loudly without session hooks", async () => {
  const loaded = await load({});
  assert.equal(Exit.isFailure(loaded.exit), true);
  assert.match(String(Exit.isFailure(loaded.exit) && loaded.exit.cause.reasons[0]?.defect), /session hooks unavailable/);
});

test("partial registration failure disposes earlier hooks", async () => {
  const { hooks, session } = fakeSession("generate");
  const loaded = await load({ session });
  assert.equal(Exit.isFailure(loaded.exit), true);
  await loaded.close(); // the host closes the plugin scope of a failed load
  assert.ok(hooks.length > 0 && hooks.every((hook) => hook.disposed));
});

test("registered http hook shapes and re-targets to the configured origin; failures are defects", async (t) => {
  const previous = process.env[GATEWAY_ORIGIN_ENV];
  process.env[GATEWAY_ORIGIN_ENV] = "http://127.0.0.1:18555";
  t.after(() => {
    if (previous === undefined) delete process.env[GATEWAY_ORIGIN_ENV];
    else process.env[GATEWAY_ORIGIN_ENV] = previous;
  });
  const { hooks, session } = fakeSession();
  const loaded = await load({ session });
  t.after(loaded.close);

  const http = hooks.find((hook) => hook.name === "http.request").handler;
  const event = {
    kind: "title",
    model: { providerID: "subs-claude", id: "claude-opus-5-5" },
    request: new Request("http://127.0.0.1:9/subs-claude-unshaped/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-opus-5-5",
        system: "Here is some useful information about the environment you are running in:",
        messages: [],
      }),
    }),
  };
  await Effect.runPromise(http(event));
  assert.equal(event.request.url, "http://127.0.0.1:18555/v1/messages");
  assert.equal(JSON.parse(await event.request.text()).system, "Environment context you are running in:");

  // Fail closed: a shaping failure is a defect (the host fails the request), the sentinel stays.
  const broken = { model: { providerID: "subs-claude" }, request: new Request("http://127.0.0.1:9/subs-claude-unshaped/v1/messages", { method: "POST", body: "not json" }) };
  const exit = await Effect.runPromise(Effect.exit(http(broken)));
  assert.equal(Exit.isFailure(exit) && exit.cause.reasons[0]?._tag, "Die");
  assert.equal(broken.request.url, "http://127.0.0.1:9/subs-claude-unshaped/v1/messages");

  const semantic = {
    model: { providerID: "subs-claude" },
    messages: [{ role: "assistant", content: [{ type: "reasoning", text: "x" }, { type: "text", text: "y" }] }],
  };
  await Effect.runPromise(hooks.find((hook) => hook.name === "context").handler(semantic));
  assert.deepEqual(semantic.messages[0].content, [{ type: "text", text: "y" }]);
});
