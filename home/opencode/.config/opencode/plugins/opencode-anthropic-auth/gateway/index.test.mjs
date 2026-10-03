import assert from "node:assert/strict";
import test from "node:test";
import plugin, { GATEWAY_ORIGIN_ENV, GATEWAY_PROVIDERS, registerGatewayHooks } from "./index.mjs";
import { ANTHROPIC_GATEWAY_PROVIDERS } from "./shaping.mjs";

function fakeSession() {
  const hooks = [];
  return {
    hooks,
    session: {
      hook: async (name, handler, options) => {
        const entry = { name, handler, options, disposed: false };
        hooks.push(entry);
        return { dispose: async () => { entry.disposed = true; } };
      },
    },
  };
}

test("provider list matches the shaping module", () => {
  assert.deepEqual([...GATEWAY_PROVIDERS], [...ANTHROPIC_GATEWAY_PROVIDERS]);
});

test("registers provider-scoped http and semantic hooks; disposer removes them", async () => {
  const { hooks, session } = fakeSession();
  const dispose = await plugin.setup({ session });

  assert.deepEqual(
    hooks.map((hook) => [hook.name, hook.options]),
    ["http.request", "context", "compaction", "generate", "title"].map((name) => [name, { providerID: "subs-claude" }]),
  );
  await dispose();
  assert.ok(hooks.every((hook) => hook.disposed));
});

test("setup fails loudly without session hooks", async () => {
  await assert.rejects(plugin.setup({}), /session hooks unavailable/);
});

test("partial registration failure disposes earlier hooks", async () => {
  const { hooks, session } = fakeSession();
  const failing = {
    hook: async (name, ...rest) => {
      if (name === "generate") throw new Error("boom");
      return session.hook(name, ...rest);
    },
  };
  await assert.rejects(registerGatewayHooks(failing), /boom/);
  assert.ok(hooks.length > 0 && hooks.every((hook) => hook.disposed));
});

test("registered http hook shapes and re-targets to the configured origin", async (t) => {
  const previous = process.env[GATEWAY_ORIGIN_ENV];
  process.env[GATEWAY_ORIGIN_ENV] = "http://127.0.0.1:18555";
  t.after(() => {
    if (previous === undefined) delete process.env[GATEWAY_ORIGIN_ENV];
    else process.env[GATEWAY_ORIGIN_ENV] = previous;
  });
  const { hooks, session } = fakeSession();
  const dispose = await plugin.setup({ session });
  t.after(dispose);

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
  await hooks.find((hook) => hook.name === "http.request").handler(event);
  assert.equal(event.request.url, "http://127.0.0.1:18555/v1/messages");
  assert.equal(JSON.parse(await event.request.text()).system, "Environment context you are running in:");

  const semantic = {
    model: { providerID: "subs-claude" },
    messages: [{ role: "assistant", content: [{ type: "reasoning", text: "x" }, { type: "text", text: "y" }] }],
  };
  await hooks.find((hook) => hook.name === "context").handler(semantic);
  assert.deepEqual(semantic.messages[0].content, [{ type: "text", text: "y" }]);
});
