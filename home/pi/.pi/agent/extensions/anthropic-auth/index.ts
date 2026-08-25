// Pi-specific adaptation of the local OpenCode Anthropic OAuth compatibility
// layer. Architecture informed by gotgenes/pi-anthropic-auth@22883511.
import { anthropicMessagesApi } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAnthropicOAuthStream } from "./transport.ts";

export default function anthropicAuth(pi: ExtensionAPI): void {
	const builtinStream = anthropicMessagesApi().streamSimple;

	// Reset any older overlay first: Pi merges repeated provider registrations.
	pi.unregisterProvider("anthropic");
	pi.registerProvider("anthropic", {
		api: "anthropic-messages",
		streamSimple: createAnthropicOAuthStream(builtinStream),
	});
}
