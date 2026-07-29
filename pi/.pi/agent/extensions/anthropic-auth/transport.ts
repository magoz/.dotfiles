import type {
	Api,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
	getClaudeCodeVersion,
	shapeAnthropicOAuthPayload,
} from "./request.ts";

export type AnthropicStream = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export function isAnthropicOAuthToken(
	apiKey: string | undefined,
): apiKey is string {
	return typeof apiKey === "string" && apiKey.includes("sk-ant-oat");
}

export async function applyPayloadTransforms(
	payload: unknown,
	apiKey: string | undefined,
	caller?: () => unknown | Promise<unknown>,
	claudeCodeVersion = getClaudeCodeVersion(),
): Promise<unknown> {
	const replaced = caller ? await caller() : undefined;
	const upstream = replaced ?? payload;

	return isAnthropicOAuthToken(apiKey)
		? shapeAnthropicOAuthPayload(upstream, claudeCodeVersion)
		: upstream;
}

function withClaudeUserAgent(
	headers: SimpleStreamOptions["headers"],
	version: string,
): NonNullable<SimpleStreamOptions["headers"]> {
	const result: NonNullable<SimpleStreamOptions["headers"]> = {};
	for (const [name, value] of Object.entries(headers ?? {})) {
		if (name.toLowerCase() !== "user-agent") result[name] = value;
	}
	result["user-agent"] = `claude-cli/${version}`;
	return result;
}

/** Wrap Pi's transport; preserve native models, login, refresh, and API keys. */
export function createAnthropicOAuthStream(
	delegate: AnthropicStream,
): AnthropicStream {
	return (model, context, options) => {
		const callerOnPayload = options?.onPayload;
		const oauth = isAnthropicOAuthToken(options?.apiKey);
		const claudeCodeVersion = getClaudeCodeVersion();
		const onPayload: SimpleStreamOptions["onPayload"] = async (
			payload,
			payloadModel,
		) =>
			applyPayloadTransforms(
				payload,
				options?.apiKey,
				callerOnPayload
					? () => callerOnPayload(payload, payloadModel)
					: undefined,
				claudeCodeVersion,
			);
		const headers = oauth
			? withClaudeUserAgent(options?.headers, claudeCodeVersion)
			: options?.headers;

		return delegate(model, context, { ...options, headers, onPayload });
	};
}
