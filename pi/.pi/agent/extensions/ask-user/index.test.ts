import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import askUser from "./index.ts";

type RegisteredTool = {
  execute(
    toolCallId: string,
    params: { question: string; options: Array<{ label: string }> },
    signal: AbortSignal,
    onUpdate: () => void,
    ctx: unknown,
  ): Promise<{
    content: Array<{ type: string; text: string }>;
    details: { answer: string | null; wasCustom: boolean };
  }>;
};

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("import and registration do not load Effect", () => {
  const loader =
    "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, nextResolve) {
        if (specifier === "effect" || specifier.startsWith("effect/")) {
          throw new Error("Effect loaded during ask-user registration: " + specifier)
        }
        return nextResolve(specifier, context)
      }
    `);
  const extensionUrl = new URL("./index.ts", import.meta.url).href;
  const script = `
    const { default: register } = await import(${JSON.stringify(extensionUrl)})
    const names = []
    register({ registerTool(tool) { names.push(tool.name) } })
    if (names.join(",") !== "ask_user") {
      throw new Error("unexpected registered tools: " + names.join(","))
    }
  `;
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-strip-types",
      "--experimental-loader",
      loader,
      "--input-type=module",
      "--eval",
      script,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
});

type EmittedEvent = { name: string; data: { active: boolean; label?: string } };

function getRegisteredTool(emitted: EmittedEvent[] = []): RegisteredTool {
  let tool: RegisteredTool | undefined;
  askUser({
    registerTool(definition: RegisteredTool) {
      tool = definition;
    },
    events: {
      emit(name: string, data: EmittedEvent["data"]) {
        emitted.push({ name, data });
      },
    },
  } as never);
  assert.ok(tool);
  return tool;
}

test("navigates options with j and k", async () => {
  const tool = getRegisteredTool();
  const renders: string[][] = [];
  const result = await tool.execute(
    "call-1",
    {
      question: "Choose one",
      options: [{ label: "Alpha" }, { label: "Beta" }],
    },
    new AbortController().signal,
    () => {},
    {
      mode: "tui",
      ui: {
        custom: async (factory: Function) => new Promise((resolve) => {
          const component = factory({ requestRender() {} }, theme, {}, resolve);

          component.handleInput("k");
          renders.push(component.render(80));

          component.handleInput("j");
          renders.push(component.render(80));

          component.handleInput("j");
          renders.push(component.render(80));

          component.handleInput("k");
          renders.push(component.render(80));

          component.handleInput("j");
          component.handleInput("\r");
        }),
      },
    },
  );

  assert.ok(renders[0]?.some((line) => line.includes("❯ ✎ Write my own answer")));
  assert.ok(renders[1]?.some((line) => line.includes("❯ 1. Alpha")));
  assert.ok(renders[2]?.some((line) => line.includes("❯ 2. Beta")));
  assert.ok(renders[3]?.some((line) => line.includes("❯ 1. Alpha")));
  assert.equal(result.details.answer, "Beta");
});

test("reports an aborted UI interaction as cancellation", async () => {
  const tool = getRegisteredTool();
  const controller = new AbortController();
  const result = await tool.execute(
    "call-cancel",
    {
      question: "Choose one",
      options: [{ label: "Alpha" }, { label: "Beta" }],
    },
    controller.signal,
    () => {},
    {
      mode: "tui",
      ui: {
        custom: async (factory: Function) =>
          new Promise((resolve) => {
            factory({ requestRender() {} }, theme, {}, resolve);
            controller.abort();
          }),
      },
    },
  );

  assert.equal(result.content[0]?.text, "Cancelled");
  assert.equal(result.details.answer, null);
});

test("keeps j and k as text in custom-answer mode", async () => {
  const tool = getRegisteredTool();
  const result = await tool.execute(
    "call-2",
    {
      question: "Choose one",
      options: [{ label: "Alpha" }, { label: "Beta" }],
    },
    new AbortController().signal,
    () => {},
    {
      mode: "tui",
      ui: {
        custom: async (factory: Function) => new Promise((resolve) => {
          const component = factory({ requestRender() {} }, theme, {}, resolve);
          component.handleInput("3");
          component.handleInput("j");
          component.handleInput("k");
          component.handleInput("\r");
        }),
      },
    },
  );

  assert.equal(result.details.answer, "jk");
  assert.equal(result.details.wasCustom, true);
});

test("broadcasts herdr:blocked while the question is open and clears it after", async () => {
  const emitted: EmittedEvent[] = [];
  const tool = getRegisteredTool(emitted);
  await tool.execute(
    "call-herdr",
    {
      question: "Choose one",
      options: [{ label: "Alpha" }, { label: "Beta" }],
    },
    new AbortController().signal,
    () => {},
    {
      mode: "tui",
      ui: {
        custom: async (factory: Function) =>
          new Promise((resolve) => {
            const component = factory(
              { requestRender() {} },
              theme,
              {},
              resolve,
            );
            assert.deepEqual(emitted, [
              { name: "herdr:blocked", data: { active: true, label: "Choose one" } },
            ]);
            component.handleInput("1");
          }),
      },
    },
  );

  assert.deepEqual(emitted, [
    { name: "herdr:blocked", data: { active: true, label: "Choose one" } },
    { name: "herdr:blocked", data: { active: false } },
  ]);
});

test("clears herdr:blocked when the question is cancelled", async () => {
  const emitted: EmittedEvent[] = [];
  const tool = getRegisteredTool(emitted);
  const controller = new AbortController();
  await tool.execute(
    "call-herdr-cancel",
    {
      question: "Choose one",
      options: [{ label: "Alpha" }, { label: "Beta" }],
    },
    controller.signal,
    () => {},
    {
      mode: "tui",
      ui: {
        custom: async (factory: Function) =>
          new Promise((resolve) => {
            factory({ requestRender() {} }, theme, {}, resolve);
            controller.abort();
          }),
      },
    },
  );

  assert.equal(emitted.at(-1)?.data.active, false);
  assert.equal(
    emitted.filter((e) => e.data.active).length,
    emitted.filter((e) => !e.data.active).length,
    "herdr:blocked emissions must be balanced",
  );
});

test("does not broadcast herdr:blocked outside the TUI", async () => {
  const emitted: EmittedEvent[] = [];
  const tool = getRegisteredTool(emitted);
  await tool.execute(
    "call-headless",
    {
      question: "Choose one",
      options: [{ label: "Alpha" }, { label: "Beta" }],
    },
    new AbortController().signal,
    () => {},
    { mode: "headless" },
  );

  assert.deepEqual(emitted, []);
});
