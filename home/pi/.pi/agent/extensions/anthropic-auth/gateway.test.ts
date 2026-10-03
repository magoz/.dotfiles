import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContext, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import {
	getClaudeCodeVersion,
	shapeAnthropicContentPayload,
	shapeAnthropicOAuthPayload,
	shapePiSystemPrompt,
} from "./request.ts";
import {
	type AnthropicStream,
	createAnthropicGatewayStream,
	createAnthropicOAuthStream,
} from "./transport.ts";

const emptyContext = normalizeContext({ messages: [] });
const piPrompt = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users.

Available tools:
- read

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)

<project_context>Keep.</project_context>`;
const summarySystem = "You are a context summarization assistant. Do NOT continue the conversation.";
const thinkingTranscript =
	"<conversation>\n[User]: Fix it.\n\n[Assistant thinking]: Secret.\n\n[Assistant]: Done.\n</conversation>";
const cleanedTranscript = "<conversation>\n[User]: Fix it.\n\n[Assistant]: Done.\n</conversation>";
const invalidAssistant = {
	role: "assistant",
	content: [
		{ type: "tool_use", id: "1", name: "read", input: {} },
		{ type: "text", text: "Done" },
	],
};
const splitAssistant = [
	{ role: "assistant", content: [{ type: "text", text: "Done" }] },
	{ role: "assistant", content: [{ type: "tool_use", id: "1", name: "read", input: {} }] },
];

function payload<System>(system: System, messages: unknown[]) {
	return { model: "claude-opus-5-5", stream: true, system, messages };
}

test("gateway content: sanitizes Pi prompt without billing or identity blocks", () => {
	const block = { type: "text", text: piPrompt, cache_control: { type: "ephemeral" } };
	const input = payload([block], [{ role: "user", content: "Hi" }]);
	const output = shapeAnthropicContentPayload(input) as typeof input;

	assert.deepEqual(output.system, [{ ...block, text: shapePiSystemPrompt(piPrompt) }]);
	assert.doesNotMatch(JSON.stringify(output), /x-anthropic-billing-header|Claude Code/);
	assert.deepEqual(output.messages, input.messages);

	const fromString = shapeAnthropicContentPayload(payload(piPrompt, [])) as typeof input;
	assert.equal(fromString.system, shapePiSystemPrompt(piPrompt));
});

test("gateway content: leaves non-Pi systems and absent systems untouched", () => {
	const blocks = [{ type: "text", text: "You are a helpful assistant." }];
	for (const system of [blocks, "You are a helpful assistant.", []]) {
		const input = payload(system, [{ role: "user", content: "Hi" }]);
		assert.deepEqual(shapeAnthropicContentPayload(input), input);
	}
	const noSystem = { model: "m", stream: false, messages: [{ role: "user", content: "Hi" }] };
	assert.equal("system" in (shapeAnthropicContentPayload(noSystem) as object), false);
	const malformed = { model: "m", messages: [] };
	assert.equal(shapeAnthropicContentPayload(malformed), malformed);
});

test("gateway content: strips summarization thinking and splits invalid ordering", () => {
	const input = payload(
		[{ type: "text", text: summarySystem }],
		[{ role: "user", content: thinkingTranscript }, invalidAssistant],
	);
	const original = structuredClone(input);
	const output = shapeAnthropicContentPayload(input) as typeof input;

	assert.deepEqual(output.messages, [{ role: "user", content: cleanedTranscript }, ...splitAssistant]);
	assert.deepEqual(output.system, input.system);
	assert.deepEqual(input, original);
	assert.deepEqual(shapeAnthropicContentPayload(output), output);
});

test("OAuth path equals content transforms plus a billing block", () => {
	const input = payload(
		[{ type: "text", text: summarySystem }, { type: "text", text: piPrompt }],
		[{ role: "user", content: thinkingTranscript }, invalidAssistant],
	);
	const content = shapeAnthropicContentPayload(input) as typeof input;
	const oauth = shapeAnthropicOAuthPayload(input, "2.1.280") as typeof input;
	assert.deepEqual(oauth.messages, content.messages);
	assert.match(oauth.system[0].text, /^x-anthropic-billing-header: cc_version=2\.1\.280\./);
	assert.deepEqual(oauth.system.slice(1), content.system);
});

function recordingDelegate() {
	const calls: SimpleStreamOptions[] = [];
	const delegate = ((_model, _context, options) => {
		calls.push(options ?? {});
		return undefined as never;
	}) as AnthropicStream;
	return { calls, delegate };
}

const model = { id: "claude-opus-5-5", api: "anthropic-messages", provider: "subs-claude" } as never;

test("gateway stream: no header changes, content fixes on payload", async () => {
	const { calls, delegate } = recordingDelegate();
	const headers = { "user-agent": "pi/1", "x-custom": "1" };
	createAnthropicGatewayStream(delegate)(model, emptyContext, { apiKey: "gateway-key", headers });

	const [options] = calls;
	assert.equal(options.headers, headers);
	assert.deepEqual(headers, { "user-agent": "pi/1", "x-custom": "1" });
	assert.equal(options.apiKey, "gateway-key");

	const input = payload([{ type: "text", text: piPrompt }], [{ role: "user", content: "Hi" }, invalidAssistant]);
	const output = (await options.onPayload?.(input, model)) as typeof input;
	assert.deepEqual(output, shapeAnthropicContentPayload(input));
	assert.equal(output.system.length, 1);
	assert.doesNotMatch(JSON.stringify(output), /x-anthropic-billing-header/);
});

test("gateway stream: applies regardless of credential shape", async () => {
	for (const apiKey of ["sk-ant-oat-looks-like-oauth", "sk-ant-api-key", undefined]) {
		const { calls, delegate } = recordingDelegate();
		createAnthropicGatewayStream(delegate)(model, emptyContext, { apiKey });
		assert.equal(calls[0].headers, undefined);
		const input = payload(piPrompt, []);
		assert.deepEqual(await calls[0].onPayload?.(input, model), shapeAnthropicContentPayload(input));
	}
});

test("gateway stream: honors the caller onPayload hook", async () => {
	const { calls, delegate } = recordingDelegate();
	const seen: unknown[] = [];
	const replacement = payload(piPrompt, [{ role: "user", content: "Replaced" }]);
	createAnthropicGatewayStream(delegate)(model, emptyContext, {
		onPayload: async (received, receivedModel) => {
			seen.push(received, receivedModel);
			return replacement;
		},
	});
	const input = payload("plain", [{ role: "user", content: "Hi" }]);
	const output = await calls[0].onPayload?.(input, model);
	assert.deepEqual(seen, [input, model]);
	assert.deepEqual(output, shapeAnthropicContentPayload(replacement));

	const passthrough = recordingDelegate();
	createAnthropicGatewayStream(passthrough.delegate)(model, emptyContext, {
		onPayload: () => undefined,
	});
	const piInput = payload(piPrompt, []);
	assert.deepEqual(
		await passthrough.calls[0].onPayload?.(piInput, model),
		shapeAnthropicContentPayload(piInput),
	);
});

test("anthropic stream: OAuth overrides user-agent, API key leaves request untouched", async () => {
	const oauth = recordingDelegate();
	createAnthropicOAuthStream(oauth.delegate)(model, emptyContext, {
		apiKey: "sk-ant-oat-test",
		headers: { "User-Agent": "pi/1", "x-custom": "1" },
	});
	assert.deepEqual(oauth.calls[0].headers, { "x-custom": "1", "user-agent": `claude-cli/${getClaudeCodeVersion()}` });

	const apiKey = recordingDelegate();
	const headers = { "user-agent": "pi/1" };
	createAnthropicOAuthStream(apiKey.delegate)(model, emptyContext, { apiKey: "sk-ant-api-test", headers });
	assert.equal(apiKey.calls[0].headers, headers);
	const input = payload(piPrompt, [invalidAssistant]);
	assert.equal(await apiKey.calls[0].onPayload?.(input, model), input);
});
