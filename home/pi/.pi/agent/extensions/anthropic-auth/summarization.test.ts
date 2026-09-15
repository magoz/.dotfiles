import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { shapeAnthropicOAuthPayload } from "./request.ts";
import { applyPayloadTransforms } from "./transport.ts";

const summarySystem = "You are a context summarization assistant. Do NOT continue the conversation.";
const envelope = (...parts: string[]) =>
	`Before\n<conversation>\n${parts.join("\n\n")}\n</conversation>\n\nSummarize this.\n[Assistant thinking]: Outside stays.`;
const kept = [
	"[User]: Fix the parser.",
	"[Assistant]: Reading.",
	'[Assistant tool calls]: read(path="parser.ts")',
	"[Tool result]: File contents.",
];
const transcript = envelope(
	"[Assistant thinking]: First thought.\n\nIts second paragraph.",
	kept[0],
	"[Assistant thinking]: Another thought.",
	...kept.slice(1),
	"[Assistant thinking]: Final thought.",
);
const cleaned = envelope(...kept);

function payload(system: unknown, content: unknown) {
	return {
		model: "claude-fable-5-1",
		stream: true,
		system,
		messages: [{ role: "user", content }],
	};
}

for (const system of [summarySystem, [{ type: "text", text: summarySystem }]]) {
	test(`strips full reasoning segments for ${typeof system === "string" ? "string" : "block"} summarization systems before billing`, () => {
		const input = payload(system, transcript);
		const original = structuredClone(input);
		const expected = shapeAnthropicOAuthPayload(payload(system, cleaned), "2.1.272");
		const output = shapeAnthropicOAuthPayload(input, "2.1.272");
		assert.deepEqual(output, expected);
		assert.deepEqual((output as typeof input).messages, [{ role: "user", content: cleaned }]);
		assert.deepEqual(input, original);
		assert.deepEqual(shapeAnthropicOAuthPayload(output, "2.1.272"), output);
		const hash = createHash("sha256").update(cleaned).digest("hex").slice(0, 5);
		assert.match(JSON.stringify(output), new RegExp(`cch=${hash};`));
	});
}

test("preserves block metadata, non-text content, non-user messages, and native thinking", () => {
	const image = { type: "image", source: { type: "url", url: "https://example.com/a.png" } };
	const block = { type: "text", text: transcript, cache_control: { type: "ephemeral" } };
	const assistant = { role: "assistant", content: [{ type: "thinking", thinking: "Native thinking", signature: "sig" }] };
	const input = { ...payload([summarySystem], [block, image, block, null]), messages: [
		{ role: "user", content: [block, image, block, null] },
		assistant,
		{ role: "tool", content: transcript },
	] };
	const expected = { ...input, messages: [
		{ role: "user", content: [{ ...block, text: cleaned }, image, { ...block, text: cleaned }, null] },
		assistant,
		input.messages[2],
	] };
	const output = shapeAnthropicOAuthPayload(input) as typeof input;
	assert.deepEqual(output.messages, expected.messages);
	assert.deepEqual(output, shapeAnthropicOAuthPayload(expected));
});

test("does not rewrite ordinary chat even when the user quotes summarization markers", () => {
	for (const system of [undefined, [], "You are a helpful assistant."]) {
		const input = payload(system, `${summarySystem}\n${transcript}`);
		const output = shapeAnthropicOAuthPayload(input) as typeof input;
		assert.deepEqual(output.messages, input.messages);
	}
});

test("leaves absent, incomplete, and reasoning-free envelopes unchanged", () => {
	for (const content of [
		"[Assistant thinking]: No envelope.",
		"<conversation>\n[Assistant thinking]: No closing tag.",
		envelope(...kept),
		"<conversation></conversation>",
	]) {
		const input = payload(summarySystem, content);
		const output = shapeAnthropicOAuthPayload(input) as typeof input;
		assert.deepEqual(output.messages, input.messages);
	}
});

test("removes reasoning-only transcript content", () => {
	assert.deepEqual(
		shapeAnthropicOAuthPayload(payload(summarySystem, envelope("[Assistant thinking]: Only thought."))),
		shapeAnthropicOAuthPayload(payload(summarySystem, envelope(""))),
	);
});

test("summarization shaping remains OAuth-only and follows the caller hook", async () => {
	const input = payload(summarySystem, transcript);
	assert.equal(await applyPayloadTransforms(input, "sk-ant-api-test"), input);
	assert.deepEqual(
		await applyPayloadTransforms({}, "sk-ant-oat-test", () => input),
		shapeAnthropicOAuthPayload(payload(summarySystem, cleaned)),
	);
});
