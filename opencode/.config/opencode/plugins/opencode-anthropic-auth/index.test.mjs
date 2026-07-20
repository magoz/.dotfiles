import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCallbackInput,
  setBaseURL,
  stripToolPrefix,
  transformRequestBody,
} from "./index.mjs";

test("parses supported OAuth callback formats", () => {
  assert.deepEqual(parseCallbackInput("code#state"), {
    code: "code",
    state: "state",
  });
  assert.deepEqual(
    parseCallbackInput("https://example.test/callback?code=code&state=state"),
    { code: "code", state: "state" },
  );
  assert.equal(parseCallbackInput("invalid"), null);
});

test("rewrites Anthropic request fingerprint", () => {
  const input = JSON.stringify({
    model: "claude-opus-4-6",
    system: [{ type: "text", text: "Project instructions" }],
    messages: [
      { role: "user", content: [{ type: "text", text: "Fix it" }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-1", name: "read", input: {} }],
      },
    ],
    tools: [{ name: "read", description: "Read", input_schema: {} }],
  });

  const output = JSON.parse(transformRequestBody(input).body);
  assert.match(output.system[0].text, /^x-anthropic-billing-header:/);
  assert.equal(
    output.system[1].text,
    "You are Claude Code, Anthropic's official CLI for Claude.",
  );
  assert.equal(output.system.length, 2);
  assert.equal(output.messages[0].content[0].text, "Project instructions");
  assert.equal(output.messages[1].content[0].name, "mcp_Read");
  assert.equal(output.tools[0].name, "mcp_Read");
});

test("restores streamed tool names", () => {
  assert.equal(
    stripToolPrefix('{"name":"mcp_Read"}\n{"name":"mcp_StructuredOutput"}'),
    '{"name": "read"}\n{"name": "StructuredOutput"}',
  );
});

test("sets base URL across V2 catalog shapes", () => {
  const legacy = { settings: { region: "us" } };
  const current = { api: { type: "aisdk" } };

  setBaseURL(legacy, "http://legacy.test");
  setBaseURL(current, "http://current.test");

  assert.deepEqual(legacy.settings, {
    region: "us",
    baseURL: "http://legacy.test",
  });
  assert.equal(current.api.url, "http://current.test");
});
