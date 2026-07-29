import assert from "node:assert/strict";
import test from "node:test";
import {
	applyPayloadTransforms,
	isAnthropicOAuthToken,
} from "./transport.ts";

test("detects only Anthropic OAuth credentials", () => {
	assert.equal(isAnthropicOAuthToken("sk-ant-oat-test"), true);
	assert.equal(isAnthropicOAuthToken("sk-ant-api-test"), false);
	assert.equal(isAnthropicOAuthToken(undefined), false);
});

test("composes caller payload hook then shapes OAuth requests", async () => {
	const output = await applyPayloadTransforms(
		{
			model: "claude-sonnet-4-5",
			stream: true,
			messages: [{ role: "user", content: "Hello" }],
			system: [],
		},
		"sk-ant-oat-test",
		() => ({
			model: "claude-sonnet-4-5",
			stream: true,
			messages: [{ role: "user", content: "Hello" }],
			system: [],
			marker: "kept",
		}),
	);

	assert.ok(isRecord(output));
	assert.equal(output.marker, "kept");
	assert.match(JSON.stringify(output.system), /x-anthropic-billing-header:/);
});

test("leaves API-key payloads unchanged", async () => {
	const payload = {
		model: "claude-sonnet-4-5",
		stream: true,
		messages: [{ role: "user", content: "Hello" }],
		system: [],
	};
	const output = await applyPayloadTransforms(payload, "sk-ant-api-test");

	assert.equal(output, payload);
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
