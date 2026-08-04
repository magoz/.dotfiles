import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import register from "./index.ts";

type ProfileName = "short" | "full";

type RegisteredCommand = {
  handler(args: string, ctx: TestContext): Promise<void>;
};

type RegisteredShortcut = {
  handler(ctx: TestContext): Promise<void>;
};

type TestModel = {
  provider: string;
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  input: string[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

type TestContext = {
  model: TestModel;
  cwd: string;
  isProjectTrusted(): boolean;
  isIdle(): boolean;
  getContextUsage(): { tokens: number | null; contextWindow: number; percent: number | null };
  sessionManager: { getBranch(): unknown[] };
  ui: {
    notify(message: string, level?: string): void;
    setStatus(key: string, value: string | undefined): void;
    select(title: string, options: string[]): Promise<string | undefined>;
  };
  compact(options: object): void;
};

function sol(contextWindow = 272_000): TestModel {
  return {
    provider: "openai-codex",
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    api: "openai-codex-responses",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow,
    maxTokens: 128_000,
  };
}

function opus(contextWindow = 1_000_000): TestModel {
  return {
    ...sol(contextWindow),
    provider: "anthropic",
    id: "claude-opus-5",
    name: "Claude Opus 5",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
  };
}

function setup(options: {
  idle?: boolean;
  tokens?: number;
  branch?: unknown[];
  selected?: string;
  initialWindow?: number;
  delaySetModel?: boolean;
  cwd?: string;
  projectTrusted?: boolean;
} = {}) {
  const commands = new Map<string, RegisteredCommand>();
  const handlers = new Map<string, Function>();
  const shortcuts = new Map<string, RegisteredShortcut>();
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  const notifications: Array<{ message: string; level?: string }> = [];
  const modelChanges: TestModel[] = [];
  const entries: Array<{ customType: string; data: unknown }> = [];
  const compactions: object[] = [];
  const selections: Array<{ title: string; options: string[] }> = [];
  let idle = options.idle ?? true;
  let model = sol(options.initialWindow);
  let releaseSetModel = () => {};
  const setModelGate = options.delaySetModel
    ? new Promise<void>((resolve) => {
        releaseSetModel = resolve;
      })
    : Promise.resolve();

  register({
    registerCommand(name: string, command: RegisteredCommand) {
      commands.set(name, command);
    },
    registerShortcut(key: string, shortcut: RegisteredShortcut) {
      shortcuts.set(key, shortcut);
    },
    on(name: string, handler: Function) {
      handlers.set(name, handler);
    },
    async setModel(next: TestModel) {
      await setModelGate;
      model = next;
      modelChanges.push(next);
      ctx.model = next;
      return true;
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data });
    },
  } as never);

  const ctx: TestContext = {
    model,
    cwd: options.cwd ?? process.cwd(),
    isProjectTrusted: () => options.projectTrusted ?? false,
    isIdle: () => idle,
    getContextUsage: () => ({
      tokens: options.tokens ?? 100_000,
      contextWindow: ctx.model.contextWindow,
      percent: ((options.tokens ?? 100_000) / ctx.model.contextWindow) * 100,
    }),
    sessionManager: { getBranch: () => options.branch ?? [] },
    ui: {
      notify(message, level) {
        notifications.push({ message, level });
      },
      setStatus(key, value) {
        statuses.push({ key, value });
      },
      async select(title, choices) {
        selections.push({ title, options: choices });
        return options.selected;
      },
    },
    compact(options) {
      compactions.push(options);
    },
  };

  return {
    commands,
    handlers,
    shortcuts,
    statuses,
    notifications,
    modelChanges,
    entries,
    compactions,
    selections,
    ctx,
    setIdle(value: boolean) {
      idle = value;
    },
    releaseSetModel,
  };
}

test("the context-budget command applies named Sol profiles while idle", async () => {
  const harness = setup();
  const command = harness.commands.get("context-budget");
  assert.ok(command);

  await command.handler("full", harness.ctx);
  assert.equal(harness.ctx.model.contextWindow, 1_050_000);
  assert.equal(harness.ctx.model.provider, "openai-codex");
  assert.equal(harness.ctx.model.id, "gpt-5.6-sol");

  await command.handler("short", harness.ctx);
  assert.equal(harness.ctx.model.contextWindow, 272_000);
  assert.deepEqual(
    harness.entries.map((entry) => entry.data),
    [
      { model: "openai-codex/gpt-5.6-sol", profile: "full" satisfies ProfileName },
      { model: "openai-codex/gpt-5.6-sol", profile: "short" satisfies ProfileName },
    ],
  );
  assert.equal(harness.statuses.at(-1)?.value, "ctx:272k");
});

test("idle profile changes do not wait on asynchronous model switching", async () => {
  const harness = setup({ delaySetModel: true });
  const command = harness.commands.get("context-budget");
  assert.ok(command);

  const operation = command.handler("full", harness.ctx);
  await Promise.resolve();

  assert.equal(harness.ctx.model.contextWindow, 1_050_000);
  assert.equal(harness.modelChanges.length, 0);

  harness.releaseSetModel();
  await operation;
});

test("streaming selections are non-blocking and only the latest applies after settling", async () => {
  const harness = setup({ idle: false });
  const command = harness.commands.get("context-budget");
  const onSettled = harness.handlers.get("agent_settled");
  assert.ok(command);
  assert.ok(onSettled);

  await command.handler("short", harness.ctx);
  await command.handler("full", harness.ctx);

  assert.equal(harness.modelChanges.length, 0);
  assert.equal(harness.statuses.at(-1)?.value, "ctx:1.05m pending");

  harness.setIdle(true);
  await onSettled({}, harness.ctx);

  assert.equal(harness.modelChanges.length, 0);
  assert.equal(harness.ctx.model.contextWindow, 1_050_000);
  assert.equal(harness.statuses.at(-1)?.value, "ctx:1.05m");
  assert.deepEqual(harness.entries.at(-1)?.data, {
    model: "openai-codex/gpt-5.6-sol",
    profile: "full",
  });
});

test("session start restores the latest saved profile without writing a duplicate", async () => {
  const harness = setup({
    branch: [
      {
        type: "custom",
        customType: "context-budget-profile",
        data: { model: "openai-codex/gpt-5.6-sol", profile: "short" },
      },
      {
        type: "custom",
        customType: "context-budget-profile",
        data: { model: "openai-codex/gpt-5.6-sol", profile: "full" },
      },
    ],
  });
  const onStart = harness.handlers.get("session_start");
  assert.ok(onStart);

  await onStart({ reason: "resume" }, harness.ctx);

  assert.equal(harness.ctx.model.contextWindow, 1_050_000);
  assert.equal(harness.statuses.at(-1)?.value, "ctx:1.05m");
  assert.equal(harness.entries.length, 0);
});

test("tree navigation restores the profile saved on the selected branch", async () => {
  const branch = [
    {
      type: "custom",
      customType: "context-budget-profile",
      data: { model: "openai-codex/gpt-5.6-sol", profile: "full" },
    },
  ];
  const harness = setup({ branch });
  const onStart = harness.handlers.get("session_start");
  const onTree = harness.handlers.get("session_tree");
  assert.ok(onStart);
  assert.ok(onTree);

  await onStart({ reason: "startup" }, harness.ctx);
  assert.equal(harness.ctx.model.contextWindow, 1_050_000);

  branch.splice(0, branch.length, {
    type: "custom",
    customType: "context-budget-profile",
    data: { model: "openai-codex/gpt-5.6-sol", profile: "short" },
  });
  await onTree({}, harness.ctx);

  assert.equal(harness.ctx.model.contextWindow, 272_000);
  assert.equal(harness.entries.length, 0);
});

test("tree navigation clears cached profiles for models not active on the new branch", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "context-budget-tree-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    writeFileSync(
      join(agentDir, "context-budget.json"),
      JSON.stringify({
        models: {
          "openai-codex/gpt-5.6-sol": {
            defaultProfile: "short",
            profiles: { short: 272000, full: 1050000 },
          },
          "anthropic/claude-opus-5": {
            defaultProfile: "focused",
            profiles: { focused: 200000, full: 1000000 },
          },
        },
      }),
    );

    const branch = [
      {
        type: "custom",
        customType: "context-budget-profile",
        data: { model: "openai-codex/gpt-5.6-sol", profile: "full" },
      },
      {
        type: "custom",
        customType: "context-budget-profile",
        data: { model: "anthropic/claude-opus-5", profile: "full" },
      },
    ];
    const harness = setup({ branch });
    const onStart = harness.handlers.get("session_start");
    const onTree = harness.handlers.get("session_tree");
    const onModelSelect = harness.handlers.get("model_select");
    assert.ok(onStart);
    assert.ok(onTree);
    assert.ok(onModelSelect);

    await onStart({ reason: "startup" }, harness.ctx);
    harness.ctx.model = opus();
    await onModelSelect({ model: harness.ctx.model, source: "set" }, harness.ctx);
    harness.ctx.model = sol();
    await onModelSelect({ model: harness.ctx.model, source: "set" }, harness.ctx);

    branch.splice(
      0,
      branch.length,
      {
        type: "custom",
        customType: "context-budget-profile",
        data: { model: "openai-codex/gpt-5.6-sol", profile: "short" },
      },
      {
        type: "custom",
        customType: "context-budget-profile",
        data: { model: "anthropic/claude-opus-5", profile: "focused" },
      },
    );
    await onTree({}, harness.ctx);

    harness.ctx.model = opus();
    await onModelSelect({ model: harness.ctx.model, source: "set" }, harness.ctx);
    assert.equal(harness.ctx.model.contextWindow, 200_000);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("model selection reapplies the session profile to a fresh registry model", async () => {
  const harness = setup({
    branch: [
      {
        type: "custom",
        customType: "context-budget-profile",
        data: { model: "openai-codex/gpt-5.6-sol", profile: "full" },
      },
    ],
  });
  const onStart = harness.handlers.get("session_start");
  const onModelSelect = harness.handlers.get("model_select");
  assert.ok(onStart);
  assert.ok(onModelSelect);

  await onStart({ reason: "resume" }, harness.ctx);
  harness.ctx.model = sol();
  await onModelSelect({ model: harness.ctx.model, source: "set" }, harness.ctx);

  assert.equal(harness.ctx.model.contextWindow, 1_050_000);
  assert.equal(harness.entries.length, 0);
});

test("switching down above the short threshold starts compaction without prompting", async () => {
  const harness = setup({ tokens: 300_000, initialWindow: 1_050_000 });
  const command = harness.commands.get("context-budget");
  assert.ok(command);

  await command.handler("short", harness.ctx);

  assert.equal(harness.compactions.length, 1);
  assert.equal(harness.notifications.length, 0);
  assert.equal(harness.statuses.at(-1)?.value, "ctx:272k compacting");
});

test("a stale compaction callback cannot restore status after selecting an unconfigured model", async () => {
  const harness = setup({ tokens: 300_000, initialWindow: 1_050_000 });
  const command = harness.commands.get("context-budget");
  const onModelSelect = harness.handlers.get("model_select");
  assert.ok(command);
  assert.ok(onModelSelect);

  await command.handler("short", harness.ctx);
  const compaction = harness.compactions[0] as { onComplete?: () => void };
  assert.ok(compaction);

  harness.ctx.model = { ...sol(), provider: "anthropic", id: "claude-opus-5" };
  await onModelSelect({ model: harness.ctx.model, source: "set" }, harness.ctx);
  assert.equal(harness.statuses.at(-1)?.value, undefined);

  compaction.onComplete?.();
  assert.equal(harness.statuses.at(-1)?.value, undefined);
});

test("a stale compaction callback cannot overwrite a newer profile status", async () => {
  const harness = setup({ tokens: 300_000, initialWindow: 1_050_000 });
  const command = harness.commands.get("context-budget");
  assert.ok(command);

  await command.handler("short", harness.ctx);
  const compaction = harness.compactions[0] as { onComplete?: () => void };
  assert.ok(compaction);

  await command.handler("full", harness.ctx);
  assert.equal(harness.statuses.at(-1)?.value, "ctx:1.05m");

  compaction.onComplete?.();
  assert.equal(harness.statuses.at(-1)?.value, "ctx:1.05m");
});

test("repeated downsizing while compaction runs reuses the in-flight compaction", async () => {
  const harness = setup({ tokens: 300_000, initialWindow: 1_050_000 });
  const command = harness.commands.get("context-budget");
  assert.ok(command);

  await command.handler("short", harness.ctx);
  const compaction = harness.compactions[0] as { onComplete?: () => void };
  assert.ok(compaction);

  await command.handler("full", harness.ctx);
  await command.handler("short", harness.ctx);

  assert.equal(harness.compactions.length, 1);
  assert.equal(harness.statuses.at(-1)?.value, "ctx:272k compacting");

  compaction.onComplete?.();
  assert.equal(harness.statuses.at(-1)?.value, "ctx:272k");
});

test("reselecting or increasing a budget never starts compaction", async () => {
  const same = setup({ tokens: 300_000, initialWindow: 272_000 });
  const sameCommand = same.commands.get("context-budget");
  assert.ok(sameCommand);
  await sameCommand.handler("short", same.ctx);
  assert.equal(same.compactions.length, 0);

  const larger = setup({ tokens: 1_040_000, initialWindow: 272_000 });
  const largerCommand = larger.commands.get("context-budget");
  assert.ok(largerCommand);
  await largerCommand.handler("full", larger.ctx);
  assert.equal(larger.compactions.length, 0);
});

test("the configured shortcut toggles between short and full profiles", async () => {
  const harness = setup();
  const shortcut = harness.shortcuts.get("alt+shift+c");
  assert.ok(shortcut);

  await shortcut.handler(harness.ctx);
  assert.equal(harness.ctx.model.contextWindow, 1_050_000);

  await shortcut.handler(harness.ctx);
  assert.equal(harness.ctx.model.contextWindow, 272_000);
});

test("status reports the active profile and effective budget", async () => {
  const harness = setup();
  const command = harness.commands.get("context-budget");
  assert.ok(command);

  await command.handler("full", harness.ctx);
  await command.handler("status", harness.ctx);

  assert.deepEqual(harness.notifications.at(-1), {
    message:
      "Context Budget for openai-codex/gpt-5.6-sol: full; 1.05m effective.",
    level: "info",
  });
});

test("the bare command opens a profile selector and applies its choice", async () => {
  const harness = setup({ selected: "full — 1.05m" });
  const command = harness.commands.get("context-budget");
  assert.ok(command);

  await command.handler("", harness.ctx);

  assert.deepEqual(harness.selections, [
    {
      title: "Context budget for openai-codex/gpt-5.6-sol",
      options: ["short — 272k", "full — 1.05m"],
    },
  ]);
  assert.equal(harness.ctx.model.contextWindow, 1_050_000);
});

test("inherited object properties cannot be selected as profiles", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "context-budget-inherited-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    writeFileSync(
      join(agentDir, "context-budget.json"),
      JSON.stringify({
        models: {
          "openai-codex/gpt-5.6-sol": {
            defaultProfile: "constructor",
            profiles: { short: 272000, full: 1050000 },
          },
        },
      }),
    );

    const harness = setup();
    const onStart = harness.handlers.get("session_start");
    const command = harness.commands.get("context-budget");
    assert.ok(onStart);
    assert.ok(command);

    await onStart({ reason: "startup" }, harness.ctx);
    assert.equal(harness.ctx.model.contextWindow, 272_000);
    assert.match(harness.notifications[0]?.message ?? "", /config error/i);

    await command.handler("constructor", harness.ctx);
    assert.equal(harness.ctx.model.contextWindow, 272_000);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("project shortcut values are ignored without rejecting valid profile overrides", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "context-budget-project-"));

  try {
    const configDir = join(projectDir, ".pi");
    mkdirSync(configDir);
    writeFileSync(
      join(configDir, "context-budget.json"),
      JSON.stringify({
        shortcut: "alt+banana",
        models: {
          "openai-codex/gpt-5.6-sol": {
            defaultProfile: "economy",
            profiles: { economy: 250000, maximum: 900000 },
          },
        },
      }),
    );

    const harness = setup({ cwd: projectDir, projectTrusted: true });
    const onStart = harness.handlers.get("session_start");
    assert.ok(onStart);
    await onStart({ reason: "startup" }, harness.ctx);

    assert.equal(harness.ctx.model.contextWindow, 250_000);
    assert.equal(harness.notifications.length, 0);
    assert.ok(harness.shortcuts.has("alt+shift+c"));
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("invalid shortcuts fall back to the safe default", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "context-budget-shortcut-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    writeFileSync(
      join(agentDir, "context-budget.json"),
      JSON.stringify({
        shortcut: "alt+banana",
        models: {
          "openai-codex/gpt-5.6-sol": {
            defaultProfile: "short",
            profiles: { short: 272000, full: 1050000 },
          },
        },
      }),
    );

    const harness = setup();
    const onStart = harness.handlers.get("session_start");
    assert.ok(onStart);
    await onStart({ reason: "startup" }, harness.ctx);

    assert.ok(harness.shortcuts.has("alt+shift+c"));
    assert.match(harness.notifications[0]?.message ?? "", /config error/i);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("invalid profile names are rejected and safe defaults remain active", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "context-budget-invalid-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    writeFileSync(
      join(agentDir, "context-budget.json"),
      JSON.stringify({
        shortcut: "alt+shift+b",
        models: {
          "openai-codex/gpt-5.6-sol": {
            defaultProfile: "status",
            profiles: { status: 272000, Full: 1050000 },
          },
        },
      }),
    );

    const harness = setup();
    const onStart = harness.handlers.get("session_start");
    assert.ok(onStart);
    await onStart({ reason: "startup" }, harness.ctx);

    assert.equal(harness.ctx.model.contextWindow, 272_000);
    assert.ok(harness.shortcuts.has("alt+shift+c"));
    assert.match(harness.notifications[0]?.message ?? "", /config error/i);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("global configuration defines profile names, budgets, default, and shortcut", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "context-budget-test-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    writeFileSync(
      join(agentDir, "context-budget.json"),
      JSON.stringify({
        shortcut: "alt+shift+b",
        models: {
          "openai-codex/gpt-5.6-sol": {
            defaultProfile: "economy",
            profiles: {
              economy: 250000,
              maximum: 900000,
            },
          },
        },
      }),
    );

    const harness = setup();
    const onStart = harness.handlers.get("session_start");
    const command = harness.commands.get("context-budget");
    assert.ok(onStart);
    assert.ok(command);
    assert.ok(harness.shortcuts.has("alt+shift+b"));

    await onStart({ reason: "startup" }, harness.ctx);
    assert.equal(harness.ctx.model.contextWindow, 250_000);

    await command.handler("maximum", harness.ctx);
    assert.equal(harness.ctx.model.contextWindow, 900_000);
    assert.deepEqual(harness.entries.at(-1)?.data, {
      model: "openai-codex/gpt-5.6-sol",
      profile: "maximum",
    });
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});
