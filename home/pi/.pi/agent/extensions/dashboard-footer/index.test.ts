import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import register from "./index.ts";

type Handler = (event: never, ctx: ExtensionContext) => unknown;
type FooterFactory = NonNullable<Parameters<ExtensionContext["ui"]["setFooter"]>[0]>;

function setup(mode = "tui", oauth = false, model = {
  provider: "openai-codex",
  id: "test-model",
  reasoning: true,
  contextWindow: 200_000,
  baseUrl: "https://chatgpt.com/backend-api",
}) {
  const handlers = new Map<string, Handler>();
  let footer: Component | undefined;
  let renders = 0;
  let execs = 0;
  const theme = {
    fg: (color: string, text: string) => {
      const code = color === "error" ? 31 : color === "warning" ? 33 : 90;
      return `\x1b[${code}m${text}\x1b[0m`;
    },
  } as unknown as Theme;
  const ctx = {
    mode,
    cwd: "/tmp/test-repo",
    model,
    getContextUsage: () => ({ tokens: 10_000, contextWindow: 200_000, percent: 5 }),
    modelRegistry: {
      isUsingOAuth: () => oauth,
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-token", headers: {} }),
    },
    ui: {
      setFooter(factory?: FooterFactory) {
        footer = factory?.(
          { requestRender: () => { renders += 1; } } as unknown as TUI,
          theme,
          { getExtensionStatuses: () => new Map([["mcp", "hidden"], ["test-status", "Other status"]]) } as unknown as ReadonlyFooterDataProvider,
        );
      },
    },
  } as unknown as ExtensionContext;
  // Deliberately no setModel, setThinkingLevel, registerProvider, or persistence API.
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    getThinkingLevel: () => "high",
    exec: async () => { execs += 1; return { code: 1, stdout: "", stderr: "" }; },
  } as unknown as ExtensionAPI;
  register(pi);
  return {
    ctx,
    emit: (event: string) => handlers.get(event)?.({} as never, ctx),
    footer: () => footer,
    renders: () => renders,
    execs: () => execs,
  };
}

test("registration and non-TUI lifecycle perform no optional I/O or polling", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => { fetches += 1; throw new Error("unexpected network"); });
  for (const mode of ["print", "json", "rpc"]) {
    const app = setup(mode, true);
    assert.equal(app.execs(), 0);
    app.emit("session_start");
    app.emit("model_select");
    app.emit("agent_settled");
    t.mock.timers.tick(600_000);
    assert.equal(app.execs(), 0);
    assert.equal(app.footer(), undefined);
    app.emit("session_shutdown");
  }
  assert.equal(fetches, 0);
});

test("registered footer renders colored usage within terminal width and stops polling on shutdown", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetches += 1;
    return Response.json({ rate_limit: {
      primary_window: { used_percent: 20, reset_after_seconds: 300 },
      secondary_window: { used_percent: 95, reset_after_seconds: 3_600 },
    } });
  });
  const app = setup("tui", true);
  assert.equal(fetches, 0);
  assert.equal(app.execs(), 0);
  assert.equal(app.emit("session_start"), undefined, "usage never holds startup open");
  // Flush the mocked network/JSON response without a wall-clock sleep.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1);
  assert.ok(app.renders() > 0);
  const lines = app.footer()!.render(200);
  assert.match(lines[1], /\x1b\[90m80% left/);
  assert.match(lines[1], /\x1b\[31m5% left/);
  assert.match(lines[1], /10\.0k \/ 200k \(5%\)/);
  assert.equal(lines.filter((line) => line.includes("Other status")).length, 1);
  assert.ok(!lines.some((line) => line.includes("hidden")));
  for (const width of [0, 1, 2, 20, 40, 80, 120]) {
    for (const line of app.footer()!.render(width)) assert.ok(visibleWidth(line) <= width);
  }
  app.emit("model_select");
  assert.equal(fetches, 1, "model selection does not bypass telemetry TTL");
  app.ctx.model!.provider = "xai";
  app.emit("model_select");
  assert.match(app.footer()!.render(200)[1], /Grok quota unavailable/);
  assert.ok(!app.footer()!.render(200)[1].includes("% left"));
  assert.equal(fetches, 1, "xai on a non-official inference origin does not fetch billing");
  app.ctx.model!.provider = "unsupported";
  app.emit("model_select");
  assert.ok(!app.footer()!.render(200)[1].includes("% left"));
  app.emit("session_shutdown");
  assert.equal(app.footer(), undefined);
  const stoppedExecs = app.execs();
  t.mock.timers.tick(600_000);
  await Promise.resolve();
  assert.equal(app.execs(), stoppedExecs);
  assert.equal(fetches, 1);
});

test("registered footer shows Grok quota from mocked billing without mutating the model or adding startup I/O", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    fetches += 1;
    assert.equal(String(url), "https://cli-chat-proxy.grok.com/v1/billing?format=credits");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-token");
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(headers.get("x-xai-token-auth"), "xai-grok-cli");
    assert.equal(headers.get("x-userid"), null);
    assert.equal(init?.redirect, "error");
    return Response.json({
      config: {
        creditUsagePercent: 20,
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          end: new Date(Date.now() + 300_000).toISOString(),
        },
      },
    });
  });
  const model = { provider: "xai", id: "grok-4.5", reasoning: true, contextWindow: 200_000, baseUrl: "https://api.x.ai/v1" };
  const before = { ...model };
  const app = setup("tui", true, model);
  assert.equal(fetches, 0);
  assert.equal(app.execs(), 0);
  assert.equal(app.emit("session_start"), undefined, "usage never holds startup open");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1);
  assert.deepEqual(app.ctx.model, before);
  assert.match(app.footer()!.render(200)[1], /\x1b\[90m80% left/);
  assert.match(app.footer()!.render(200)[1], /7d /);
  assert.ok(!app.footer()!.render(200)[1].includes("Grok quota unavailable"));
  t.mock.method(globalThis, "fetch", async () => {
    fetches += 1;
    return Response.json({ config: {} });
  });
  app.ctx.modelRegistry.isUsingOAuth = () => false;
  app.emit("model_select");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1, "API-key Grok does not fetch billing");
  assert.match(app.footer()!.render(200)[1], /Grok quota unavailable/);
  assert.ok(!app.footer()!.render(200)[1].includes("% left"));
  assert.deepEqual(app.ctx.model, before);
  app.emit("session_shutdown");
  t.mock.timers.tick(600_000);
  await Promise.resolve();
  assert.equal(fetches, 1);
});

test("registered footer shows OpenCode Go quota in API-key mode without mutating the model", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    fetches += 1;
    assert.equal(String(url), "https://opencode.ai/zen/go/v1/usage");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-token");
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(init?.redirect, "error");
    return Response.json({
      usage: {
        rolling: { status: "ok", percent: 20, resetsAt: new Date(Date.now() + 300_000).toISOString() },
        weekly: { status: "ok", percent: 40, resetsAt: new Date(Date.now() + 3_600_000).toISOString() },
        monthly: { status: "ok", percent: 10, resetsAt: new Date(Date.now() + 86_400_000).toISOString() },
      },
    });
  });
  const model = { provider: "opencode-go", id: "muse-spark-1.3-contributor", reasoning: true, contextWindow: 1_000_000, baseUrl: "https://opencode.ai/zen/go/v1" };
  const before = { ...model };
  const app = setup("tui", false, model);
  assert.equal(app.emit("session_start"), undefined, "usage never holds startup open");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1);
  assert.deepEqual(app.ctx.model, before);
  const line = app.footer()!.render(200)[1];
  assert.match(line, /80% left/);
  assert.match(line, /5h /);
  assert.match(line, /7d /);
  assert.match(line, /month /);
  app.ctx.modelRegistry.isUsingOAuth = () => true;
  app.emit("model_select");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1, "OAuth-mode Go does not fetch usage");
  assert.deepEqual(app.ctx.model, before);
  app.emit("session_shutdown");
});
