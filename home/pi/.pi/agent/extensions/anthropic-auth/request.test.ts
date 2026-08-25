import assert from "node:assert/strict";
import test from "node:test";
import {
	shapeAnthropicOAuthPayload,
	shapePiSystemPrompt,
} from "./request.ts";

const piPrompt = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files.

Available tools:
- read
- bash

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
- Be concise in your responses

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /pi/README.md
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)

<project_context>Keep this verbatim.</project_context>`;

test("sanitizes Pi preamble but preserves tools and project context", () => {
	const output = shapePiSystemPrompt(piPrompt);

	assert.match(output, /^You are an expert coding assistant\./);
	assert.match(output, /Available tools:\n- read\n- bash/);
	assert.match(output, /<project_context>Keep this verbatim\.<\/project_context>/);
	assert.doesNotMatch(output, /coding agent harness/);
	assert.doesNotMatch(output, /Main documentation/);
});

test("injects billing and repairs assistant tool ordering", () => {
	const input = {
		model: "claude-opus-4-6",
		stream: true,
		system: [
			{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
			{ type: "text", text: piPrompt, cache_control: { type: "ephemeral" } },
		],
		messages: [
			{ role: "user", content: [{ type: "text", text: "Fix it" }] },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "1", name: "Read", input: {} },
					{ type: "text", text: "Done" },
				],
			},
		],
	};

	const output = shapeAnthropicOAuthPayload(input, "2.1.220");
	assert.ok(isRecord(output));
	const serialized = JSON.stringify(output);
	assert.match(serialized, /x-anthropic-billing-header:/);
	assert.match(serialized, /cc_version=2\.1\.220\./);
	assert.ok(Array.isArray(output.messages));
	assert.deepEqual(output.messages, [
		input.messages[0],
		{ role: "assistant", content: [{ type: "text", text: "Done" }] },
		{
			role: "assistant",
			content: [{ type: "tool_use", id: "1", name: "Read", input: {} }],
		},
	]);
	assert.ok(Array.isArray(output.system));
	assert.deepEqual(output.system[1], input.system[0]);
	assert.deepEqual(output.system[2], {
		...input.system[1],
		text: shapePiSystemPrompt(piPrompt),
	});
});

test("is idempotent and ignores malformed payloads", () => {
	const malformed = { model: "claude", messages: [] };
	assert.equal(shapeAnthropicOAuthPayload(malformed), malformed);

	const input = {
		model: "claude-sonnet-4-5",
		stream: true,
		messages: [{ role: "user", content: "Hello" }],
		system: [{ type: "text", text: "x-anthropic-billing-header: existing" }],
	};
	const once = shapeAnthropicOAuthPayload(input, "2.1.220");
	const twice = shapeAnthropicOAuthPayload(once, "2.1.220");

	assert.deepEqual(twice, once);
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
