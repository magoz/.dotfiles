import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";
import { loadConfig } from "./src/config.ts";
import { createRuntime, STATE_TYPE } from "./src/runtime.ts";

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "pi-primary-agent-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configPath = join(dir, "primary-agents.json");
  const config = {
    default: "coding" as string | null,
    agents: {
      coding: { description: "Coding", prompt: "coding.md", workers: ["general"], models: ["provider/model"] },
      other: { description: "Other", prompt: "other.md", workers: [], models: [] },
    },
  };
  const saveConfig = () => writeFileSync(configPath, JSON.stringify(config));
  saveConfig();
  writeFileSync(join(dir, "coding.md"), "Own the architecture. Delegate by judgment.");
  writeFileSync(join(dir, "other.md"), "Another identity.");
  let manager = SessionManager.inMemory(dir);
  let idle = true;
  let base = "BASE: repository instructions and tool guidance";
  let tools = ["read", "edit", "subagent"];
  let selected: string | undefined;
  const notices: string[] = [];
  const statuses = new Map<string, string | undefined>();
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => any>();
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => any }>();
  // Any attempt to mutate a model, tools, thinking, or messages fails the test.
  const api = new Proxy({
    on: (name: string, handler: (event: any, ctx: ExtensionContext) => any) => handlers.set(name, handler),
    registerCommand: (name: string, command: { handler: (args: string, ctx: ExtensionContext) => any }) => commands.set(name, command),
    appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data),
    getActiveTools: () => tools,
  }, {
    get(target, key) {
      assert.ok(key in target, `Unexpected Pi API access: ${String(key)}`);
      return Reflect.get(target, key);
    },
  }) as unknown as ExtensionAPI;
  const ctx = {
    cwd: dir,
    hasUI: true,
    get sessionManager() { return manager; },
    isIdle: () => idle,
    getSystemPrompt: () => base,
    ui: {
      setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
      notify: (message: string) => notices.push(message),
      select: async () => selected,
    },
  } as unknown as ExtensionContext;
  const runtime = createRuntime(api, dir);
  return {
    dir, configPath, config, saveConfig, api, ctx, notices, statuses, runtime, handlers, commands,
    get manager() { return manager; },
    setManager: (next: SessionManager) => { manager = next; },
    setIdle: (value: boolean) => { idle = value; },
    setBase: (value: string) => { base = value; },
    setTools: (value: string[]) => { tools = value; },
    select: (value: string | undefined) => { selected = value; },
    prompt: () => runtime.beforeStart(base, ctx)?.systemPrompt ?? base,
  };
}

test("default activates without changing session, messages, model, thinking, or tools", (t) => {
  const f = fixture(t);
  const id = f.manager.getSessionId();
  f.manager.appendMessage({ role: "user", content: "Existing conversation", timestamp: Date.now() });
  f.runtime.restore(f.ctx);
  assert.equal(f.manager.getSessionId(), id);
  assert.equal(f.manager.buildSessionContext().messages.length, 1);
  assert.equal(f.statuses.get("primary-agent"), "agent:coding");
  assert.match(f.prompt(), /^BASE: repository instructions and tool guidance\n\n<primary_agent name="coding">/);
  assert.match(f.prompt(), /general/);
  assert.match(f.prompt(), /provider\/model/);
  assert.equal(f.prompt().match(/<primary_agent /g)?.length, 1);
  const count = f.manager.getEntries().length;
  f.prompt();
  f.runtime.restore(f.ctx);
  assert.equal(f.manager.getEntries().length, count, "no per-turn or reload state spam");
  assert.equal(f.notices.length, 0, "silent startup");
});

test("switch and clear persist through reload, compaction, resume, and tree navigation", async (t) => {
  const f = fixture(t);
  f.runtime.restore(f.ctx);
  const codingLeaf = f.manager.getLeafId()!;
  await f.runtime.command("other", f.ctx);
  const otherLeaf = f.manager.getLeafId()!;
  await f.runtime.command("clear", f.ctx);
  const userId = f.manager.appendMessage({ role: "user", content: "Keep this", timestamp: Date.now() });
  f.manager.appendCompaction("summary", userId, 100);
  const restored = createRuntime(f.api, f.dir);
  restored.restore(f.ctx);
  assert.equal(restored.beforeStart("BASE", f.ctx), undefined, "compaction/reload retains explicit clear");
  f.manager.branch(otherLeaf);
  restored.restore(f.ctx);
  assert.match(restored.beforeStart("BASE", f.ctx)!.systemPrompt, /name="other"/);
  f.manager.branch(codingLeaf);
  restored.restore(f.ctx);
  assert.match(restored.beforeStart("BASE", f.ctx)!.systemPrompt, /name="coding"/);
  f.setManager(SessionManager.inMemory(f.dir));
  restored.restore(f.ctx);
  assert.match(restored.beforeStart("BASE", f.ctx)!.systemPrompt, /name="coding"/, "new session gets default");
});

test("absent default is pinned as none and config changes do not silently reselect", (t) => {
  const f = fixture(t);
  f.config.default = null;
  f.saveConfig();
  f.runtime.restore(f.ctx);
  f.config.default = "coding";
  f.saveConfig();
  f.runtime.restore(f.ctx);
  assert.equal(f.prompt(), f.ctx.getSystemPrompt());
});

test("bad selection or prompt leaves working identity intact; busy and cancelled selection do nothing", async (t) => {
  const f = fixture(t);
  f.runtime.restore(f.ctx);
  const leaf = f.manager.getLeafId();
  await f.runtime.command("not-found", f.ctx);
  rmSync(join(f.dir, "other.md"));
  await f.runtime.command("other", f.ctx);
  f.setIdle(false);
  await f.runtime.command("clear", f.ctx);
  f.setIdle(true);
  await f.runtime.command("", f.ctx);
  assert.equal(f.manager.getLeafId(), leaf);
  assert.match(f.prompt(), /name="coding"/);
  assert.ok(f.notices.some((notice) => notice.includes("idle")));
});

test("picker and status use the public command behavior", async (t) => {
  const f = fixture(t);
  f.runtime.restore(f.ctx);
  f.select("other — Other");
  await f.runtime.command("", f.ctx);
  assert.match(f.prompt(), /name="other"/);
  await f.runtime.command("status", f.ctx);
  assert.match(f.notices.at(-1)!, /Primary agent: other/);
  f.select("(none) — clear primary identity");
  await f.runtime.command("", f.ctx);
  assert.equal(f.prompt(), f.ctx.getSystemPrompt());
});

test("missing active definition and malformed config are visible, recoverable, and never select fallback", async (t) => {
  const f = fixture(t);
  f.runtime.restore(f.ctx);
  rmSync(join(f.dir, "coding.md"));
  f.runtime.restore(f.ctx);
  assert.match(f.prompt(), /configuration is unavailable/);
  const notices = f.notices.length;
  f.prompt();
  assert.equal(f.notices.length, notices, "warning deduplicated");
  writeFileSync(f.configPath, "broken json");
  await f.runtime.command("clear", f.ctx);
  assert.equal(f.prompt(), f.ctx.getSystemPrompt());
  f.runtime.restore(f.ctx);
  assert.equal(f.prompt(), f.ctx.getSystemPrompt(), "clear survives reload with broken config");
  f.saveConfig();
  f.runtime.restore(f.ctx);
  assert.equal(f.prompt(), f.ctx.getSystemPrompt());
});

test("latest valid state repairs an older invalid entry", async (t) => {
  const f = fixture(t);
  f.manager.appendCustomEntry(STATE_TYPE, { version: 999 });
  f.runtime.restore(f.ctx);
  assert.match(f.prompt(), /configuration is unavailable/);
  await f.runtime.command("clear", f.ctx);
  f.runtime.restore(f.ctx);
  assert.equal(f.prompt(), f.ctx.getSystemPrompt());
});

test("missing subagent tool is reported without enabling tools or inventing an execution fallback", (t) => {
  const f = fixture(t);
  f.setTools(["read"]);
  f.runtime.restore(f.ctx);
  assert.match(f.prompt(), /subagent tool is not active/);
});

test("config validates names and rejects parent model/thinking/tool settings", (t) => {
  const f = fixture(t);
  assert.equal(loadConfig(f.configPath).agents.coding.prompt, join(f.dir, "coding.md"));
  for (const field of ["model", "thinkingLevel", "tools"]) {
    writeFileSync(f.configPath, JSON.stringify({ agents: { coding: { prompt: "coding.md", [field]: "bad" } } }));
    assert.throws(() => loadConfig(f.configPath), /Unknown field/);
  }
  writeFileSync(f.configPath, JSON.stringify({ agents: { clear: { prompt: "coding.md" } } }));
  assert.throws(() => loadConfig(f.configPath), /reserved/);
  rmSync(f.configPath);
  assert.equal(loadConfig(f.configPath).default, null);
});

test("model guidance and legacy identifiers render in prompt/status and survive compaction restore", async (t) => {
  const f = fixture(t);
  const models = ["provider/legacy", { id: "provider/ui", guidance: "Prefer for UI implementation." }];
  writeFileSync(f.configPath, JSON.stringify({
    default: "coding", agents: { coding: { ...f.config.agents.coding, models } },
  }));
  assert.deepEqual(loadConfig(f.configPath).agents.coding.models, [
    { id: "provider/legacy" }, { id: "provider/ui", guidance: "Prefer for UI implementation." },
  ]);
  f.runtime.restore(f.ctx);
  assert.match(f.prompt(), /Model selection guide:\n- provider\/legacy\n- provider\/ui: Prefer for UI implementation\./);
  assert.doesNotMatch(f.prompt(), /\[object Object\]/);
  await f.runtime.command("status", f.ctx);
  assert.match(f.notices.at(-1)!, /provider\/ui: Prefer for UI implementation\./);
  const userId = f.manager.appendMessage({ role: "user", content: "Continue", timestamp: Date.now() });
  f.manager.appendCompaction("summary", userId, 100);
  const restored = createRuntime(f.api, f.dir);
  restored.restore(f.ctx);
  assert.match(restored.beforeStart("BASE", f.ctx)!.systemPrompt!, /Prefer for UI implementation\./);
});

test("model guidance rejects malformed entries and unsupported routing fields", (t) => {
  const f = fixture(t);
  for (const models of [
    "provider/model", [null], [42], ["unqualified"], [{ id: "unqualified" }],
    [{ id: "provider/model", guidance: " " }], [{ id: "provider/model", guidance: 1 }],
    [{ id: "provider/model", fallbackModels: [] }],
  ]) {
    writeFileSync(f.configPath, JSON.stringify({ agents: { coding: { prompt: "coding.md", models } } }));
    assert.throws(() => loadConfig(f.configPath), /coding\.models/);
  }
});

test("tracked coding model guide is included in the active primary prompt", (t) => {
  const f = fixture(t);
  const agentDir = fileURLToPath(new URL("../../", import.meta.url));
  const config = loadConfig(join(agentDir, "primary-agents.json"));
  const runtime = createRuntime(f.api, agentDir);
  runtime.restore(f.ctx);
  const prompt = runtime.beforeStart("BASE", f.ctx)!.systemPrompt!;
  for (const model of config.agents.coding.models) {
    assert.ok(model.guidance);
    assert.ok(prompt.includes(`${model.id}: ${model.guidance}`));
  }
  assert.match(prompt, /Never send private or unknown-visibility repository context to Muse by default/);
  assert.match(prompt, /explicit user instruction.*overrides this default routing regardless of repository visibility/i);
});

test("disk resume and fork preserve explicit clear without replaying primary instructions as messages", async (t) => {
  const f = fixture(t);
  f.setManager(SessionManager.create(f.dir, join(f.dir, "sessions")));
  f.runtime.restore(f.ctx);
  // Pi intentionally persists sessions only after their first assistant response.
  f.manager.appendMessage({
    role: "assistant", content: [{ type: "text", text: "Existing response" }],
    api: "openai-responses", provider: "openai", model: "gpt-5", stopReason: "stop", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  await f.runtime.command("clear", f.ctx);
  const sessionId = f.manager.getSessionId();
  const path = f.manager.getSessionFile()!;
  f.setManager(SessionManager.open(path));
  assert.equal(f.manager.getSessionId(), sessionId);
  f.runtime.restore(f.ctx);
  assert.equal(f.prompt(), f.ctx.getSystemPrompt());
  f.manager.createBranchedSession(f.manager.getLeafId()!);
  assert.notEqual(f.manager.getSessionId(), sessionId);
  f.runtime.restore(f.ctx);
  assert.equal(f.prompt(), f.ctx.getSystemPrompt());
  assert.equal(f.manager.buildSessionContext().messages.length, 1);
});

test("entry import and registration do not import runtime, SDK, filesystem, or process runners", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import { registerHooks } from 'node:module';
    import assert from 'node:assert/strict';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.includes('/src/') || specifier.includes('@earendil-works') || /^(node:)?(fs|child_process)/.test(specifier))
        throw new Error('Eager dependency: ' + specifier);
      return next(specifier, context);
    }});
    const { default: extension } = await import(${JSON.stringify(new URL("./index.ts", import.meta.url).href)});
    const events = [];
    const commands = [];
    extension({ on: name => events.push(name), registerCommand: name => commands.push(name) });
    assert.deepEqual(commands, ['agent']);
    assert.deepEqual(events, ['session_start', 'session_tree', 'before_agent_start']);
    process.env.PI_SUBAGENT_CHILD = '1';
    extension(new Proxy({}, { get() { throw new Error('Child registered a handler'); } }));
  `], { encoding: "utf8", env: { ...process.env, PI_SUBAGENT_CHILD: "" } });
  assert.equal(result.status, 0, result.stderr);
});

test("real SDK loader and command dispatch preserve identity/model independence and child isolation", async (t) => {
  const f = fixture(t);
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = f.dir;
  t.after(() => {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
  });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(f.dir, "auth.json"), modelsPath: null,
    modelsStorePath: join(f.dir, "models-cache.json"), refreshOnCreate: false, allowModelNetwork: false,
  });
  // Fake local auth permits the normal /model mutation path; inference is forbidden.
  await modelRuntime.setRuntimeApiKey("openai", "test-only-not-a-real-key");
  modelRuntime.streamSimple = () => { throw new Error("Test must not call a model"); };
  const model = modelRuntime.getModel("openai", "gpt-5")!;
  assert.ok(model);
  for (const child of [false, true]) {
    const settingsManager = SettingsManager.inMemory({ packages: [], extensions: [] });
    const loader = new DefaultResourceLoader({
      cwd: f.dir, agentDir: f.dir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalExtensionPaths: [fileURLToPath(new URL("./index.ts", import.meta.url))],
      systemPrompt: child ? '<active_agent name="general"/>\nWorker task.' : "ROOT INSTRUCTIONS",
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const manager = SessionManager.inMemory(f.dir);
    if (child) manager.appendCustomEntry(STATE_TYPE, { version: 1, name: "coding" });
    const { session } = await createAgentSession({
      cwd: f.dir, agentDir: f.dir, modelRuntime, model, thinkingLevel: "high",
      settingsManager, sessionManager: manager, resourceLoader: loader,
    });
    t.after(() => session.dispose());
    const errors: unknown[] = [];
    await session.bindExtensions({ onError: (error) => errors.push(error) });
    const runner = session.extensionRunner;
    assert.ok(runner.getCommand("agent"));
    const original = { id: session.sessionId, model: session.model, thinking: session.thinkingLevel, tools: session.getActiveToolNames(), messages: session.messages };
    const render = () => runner.emitBeforeAgentStart("test without a model call", undefined, session.systemPrompt, { cwd: f.dir });
    if (child) {
      const entries = manager.getEntries().length;
      await session.prompt("/agent coding");
      assert.equal(await render(), undefined);
      assert.equal(manager.getEntries().length, entries);
    } else {
      assert.match((await render())!.systemPrompt!, /name="coding"/);
      await session.prompt("/agent other");
      assert.match((await render())!.systemPrompt!, /name="other"/);
      const differentModel = modelRuntime.getModel("openai", "gpt-5-mini")!;
      await session.setModel(differentModel);
      assert.match((await render())!.systemPrompt!, /name="other"/, "manual model selection keeps identity");
      await session.prompt("/agent clear");
      assert.equal(session.model, differentModel, "clear does not restore a captured model");
      assert.equal(await render(), undefined);
      await session.setModel(model);
    }
    assert.equal(session.sessionId, original.id);
    assert.equal(session.model, original.model);
    assert.equal(session.thinkingLevel, original.thinking);
    assert.deepEqual(session.getActiveToolNames(), original.tools);
    assert.deepEqual(session.messages, original.messages);
    assert.deepEqual(errors, []);
  }
});

test("registered interface restores root identity but foreground children ignore even copied primary state", async (t) => {
  const f = fixture(t);
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = f.dir;
  t.after(() => {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
  });
  extension(f.api);
  await f.handlers.get("session_start")!({ reason: "startup" }, f.ctx);
  const prompt = await f.handlers.get("before_agent_start")!({ systemPrompt: "ROOT" }, f.ctx);
  assert.match(prompt.systemPrompt, /name="coding"/);
  const count = f.manager.getEntries().length;
  f.setBase('<active_agent name="general"/>\n\nWorker instructions.');
  await f.handlers.get("session_start")!({ reason: "fork" }, f.ctx);
  await f.commands.get("agent")!.handler("coding", f.ctx);
  assert.equal(await f.handlers.get("before_agent_start")!({ systemPrompt: f.ctx.getSystemPrompt() }, f.ctx), undefined);
  assert.equal(f.manager.getEntries().length, count);
  f.setBase("ROOT");
  await f.commands.get("agent")!.handler("clear", f.ctx);
  await f.handlers.get("session_start")!({ reason: "reload" }, f.ctx);
  assert.equal(await f.handlers.get("before_agent_start")!({ systemPrompt: "ROOT" }, f.ctx), undefined);
});
