// Pi-specific adaptation of the local OpenCode Anthropic OAuth compatibility
// layer. Architecture informed by gotgenes/pi-anthropic-auth@22883511.
import { anthropicMessagesApi } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createAnthropicGatewayStream,
	createAnthropicOAuthStream,
} from "./transport.ts";

/**
 * models.json providers routed through a Claude Code-impersonating gateway
 * (CLIProxyAPI). They get content fixes only; the gateway owns billing/identity.
 */
export const ANTHROPIC_GATEWAY_PROVIDERS = ["subs-claude"] as const;

export default function anthropicAuth(pi: ExtensionAPI): void {
	const builtinStream = anthropicMessagesApi().streamSimple;

	// Reset any older overlay first: Pi merges repeated provider registrations.
	pi.unregisterProvider("anthropic");
	pi.registerProvider("anthropic", {
		api: "anthropic-messages",
		streamSimple: createAnthropicOAuthStream(builtinStream),
	});

	// Stream-only overlay: models, baseUrl, and auth stay in models.json/auth.json.
	for (const provider of ANTHROPIC_GATEWAY_PROVIDERS) {
		pi.unregisterProvider(provider);
		pi.registerProvider(provider, {
			api: "anthropic-messages",
			streamSimple: createAnthropicGatewayStream(builtinStream),
		});
	}
}
