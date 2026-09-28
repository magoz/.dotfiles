import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import anthropicAuth, { ANTHROPIC_GATEWAY_PROVIDERS } from "./index.ts";

test("registers anthropic and stream-only gateway overlays", () => {
	const calls: Array<[string, string, Record<string, unknown>?]> = [];
	const pi = {
		unregisterProvider: (name: string) => calls.push(["unregister", name]),
		registerProvider: (name: string, config: Record<string, unknown>) =>
			calls.push(["register", name, config]),
	} as unknown as ExtensionAPI;

	anthropicAuth(pi);

	assert.deepEqual([...ANTHROPIC_GATEWAY_PROVIDERS], ["subs-claude"]);
	assert.deepEqual(
		calls.map(([action, name]) => `${action}:${name}`),
		["unregister:anthropic", "register:anthropic", "unregister:subs-claude", "register:subs-claude"],
	);
	for (const [action, , config] of calls) {
		if (action !== "register") continue;
		assert.equal(config?.api, "anthropic-messages");
		assert.equal(typeof config?.streamSimple, "function");
	}
	// models, baseUrl, and auth must come from models.json/auth.json.
	const gateway = calls.find(([action, name]) => action === "register" && name === "subs-claude");
	assert.deepEqual(Object.keys(gateway?.[2] ?? {}).sort(), ["api", "streamSimple"]);
});
