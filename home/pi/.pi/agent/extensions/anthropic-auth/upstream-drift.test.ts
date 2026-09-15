import assert from "node:assert/strict";
import test from "node:test";
import { shapeAnthropicOAuthPayload } from "./request.ts";
import { SUMMARIZATION_PROMPT_ANCHOR } from "./summarization.ts";

// Test-only access to Pi internals: catch serializer/prompt changes on SDK bumps.
// Override the entrypoint to verify the global CLI as well as the workspace SDK.
const entrypoint = process.env.PI_TEST_CODING_AGENT_ENTRYPOINT
	?? import.meta.resolve("@earendil-works/pi-coding-agent");
const { serializeConversation, SUMMARIZATION_SYSTEM_PROMPT } = await import(
	new URL("./core/compaction/utils.js", entrypoint).href
);

test("shapes the installed Pi's summarization prompt and serialized transcript", () => {
	assert.ok(SUMMARIZATION_SYSTEM_PROMPT.startsWith(SUMMARIZATION_PROMPT_ANCHOR));
	const messages = [
		{ role: "user", content: [{ type: "text", text: "Fix the parser." }] },
		{ role: "assistant", content: [
			{ type: "thinking", thinking: "First thought.\n\nSecond thought." },
			{ type: "text", text: "Reading." },
			{ type: "toolCall", name: "read", arguments: { path: "parser.ts" } },
		] },
		{ role: "toolResult", content: [{ type: "text", text: "File contents." }] },
	];
	const transcript = serializeConversation(messages);
	assert.match(transcript, /\[Assistant thinking\]: First thought\./);
	const input = {
		model: "claude-fable-5-1",
		stream: true,
		system: [{ type: "text", text: SUMMARIZATION_SYSTEM_PROMPT }],
		messages: [{ role: "user", content: `<conversation>\n${transcript}\n</conversation>` }],
	};
	const output = shapeAnthropicOAuthPayload(input) as typeof input;
	assert.equal(output.messages[0].content, `<conversation>\n${[
		"[User]: Fix the parser.",
		"[Assistant]: Reading.",
		'[Assistant tool calls]: read(path="parser.ts")',
		"[Tool result]: File contents.",
	].join("\n\n")}\n</conversation>`);
});
