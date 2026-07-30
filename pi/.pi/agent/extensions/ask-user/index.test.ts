import assert from "node:assert/strict";
import test from "node:test";
import askUser from "./index.ts";

type RegisteredTool = {
  execute(
    toolCallId: string,
    params: { question: string; options: Array<{ label: string }> },
    signal: AbortSignal,
    onUpdate: () => void,
    ctx: unknown,
  ): Promise<{ details: { answer: string | null; wasCustom: boolean } }>;
};

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function getRegisteredTool(): RegisteredTool {
  let tool: RegisteredTool | undefined;
  askUser({
    registerTool(definition: RegisteredTool) {
      tool = definition;
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
