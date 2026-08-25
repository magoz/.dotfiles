import { createHash } from "node:crypto";

const DEFAULT_CLAUDE_CODE_VERSION = "2.1.220";
const CLAUDE_CODE_ENTRYPOINT = "sdk-cli";
const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";
const BILLING_HEADER_SALT = "59cf53e54c78";
const BILLING_HEADER_POSITIONS = [4, 7, 20];
const PI_PROMPT_PREFIX =
	"You are an expert coding assistant operating inside pi, a coding agent harness.";
const PI_PROMPT_TERMINATOR =
	"- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)";
const NEUTRAL_PROMPT = [
	"You are an expert coding assistant.",
	"Be concise and helpful.",
	"Use the available tools to answer the user's request.",
	"Show file paths clearly when working with files.",
].join("\n");
const REMOVED_PARAGRAPH_ANCHORS = [
	"operating inside pi, a coding agent harness",
	"In addition to the tools above",
	"Pi documentation (read only when the user asks about pi itself",
];
const ENVIRONMENT_FINGERPRINT =
	"Here is some useful information about the environment you are running in:";

type JsonRecord = Record<string, unknown>;

type AnthropicPayload = JsonRecord & {
	model: string;
	messages: unknown[];
	stream: boolean;
};

function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAnthropicPayload(value: unknown): value is AnthropicPayload {
	return (
		isRecord(value) &&
		typeof value.model === "string" &&
		Array.isArray(value.messages) &&
		typeof value.stream === "boolean"
	);
}

export function getClaudeCodeVersion(): string {
	return process.env.ANTHROPIC_CLI_VERSION ?? DEFAULT_CLAUDE_CODE_VERSION;
}

function textFromFirstUserMessage(messages: unknown[]): string {
	for (const message of messages) {
		if (!isRecord(message) || message.role !== "user") continue;
		if (typeof message.content === "string") return message.content;
		if (!Array.isArray(message.content)) return "";

		for (const block of message.content) {
			if (
				isRecord(block) &&
				block.type === "text" &&
				typeof block.text === "string"
			) {
				return block.text;
			}
		}
		return "";
	}
	return "";
}

function billingHeader(messages: unknown[], version: string): string | undefined {
	const firstUserText = textFromFirstUserMessage(messages);
	if (!firstUserText) return undefined;

	const cch = createHash("sha256")
		.update(firstUserText)
		.digest("hex")
		.slice(0, 5);
	const sampled = BILLING_HEADER_POSITIONS.map(
		(index) => firstUserText[index] ?? "0",
	).join("");
	const suffix = createHash("sha256")
		.update(`${BILLING_HEADER_SALT}${sampled}${version}`)
		.digest("hex")
		.slice(0, 3);

	return `${BILLING_HEADER_PREFIX} cc_version=${version}.${suffix}; cc_entrypoint=${CLAUDE_CODE_ENTRYPOINT}; cch=${cch};`;
}

function systemText(block: unknown): string | undefined {
	if (typeof block === "string") return block;
	if (isRecord(block) && typeof block.text === "string") return block.text;
	return undefined;
}

function replaceSystemText(block: unknown, text: string): JsonRecord {
	return isRecord(block) ? { ...block, type: "text", text } : { type: "text", text };
}

function sanitizeParagraphs(text: string): string {
	const kept = text.split(/\n\n+/).filter((paragraph) =>
		REMOVED_PARAGRAPH_ANCHORS.every(
			(anchor) => !paragraph.includes(anchor),
		),
	);

	return kept
		.join("\n\n")
		.replaceAll(ENVIRONMENT_FINGERPRINT, "Environment context you are running in:")
		.trim();
}

export function shapePiSystemPrompt(text: string): string {
	const prefixIndex = text.indexOf(PI_PROMPT_PREFIX);
	if (prefixIndex === -1) return text;

	const terminatorIndex = text.indexOf(PI_PROMPT_TERMINATOR, prefixIndex);
	const end =
		terminatorIndex === -1
			? text.length
			: terminatorIndex + PI_PROMPT_TERMINATOR.length;
	const sanitized = sanitizeParagraphs(text.slice(prefixIndex, end));
	const replacement = sanitized
		? `${NEUTRAL_PROMPT}\n\n${sanitized}`
		: NEUTRAL_PROMPT;

	return text.slice(0, prefixIndex) + replacement + text.slice(end);
}

function shapeSystem(system: unknown, header: string | undefined): unknown {
	if (!Array.isArray(system)) return system;

	const shaped = system.map((block) => {
		const text = systemText(block);
		return text?.includes(PI_PROMPT_PREFIX)
			? replaceSystemText(block, shapePiSystemPrompt(text))
			: block;
	});
	if (!header) return shaped;
	if (shaped.some((block) => systemText(block)?.includes(BILLING_HEADER_PREFIX))) {
		return shaped;
	}

	return [{ type: "text", text: header }, ...shaped];
}

function splitInvalidAssistantMessage(message: unknown): unknown[] {
	if (
		!isRecord(message) ||
		message.role !== "assistant" ||
		!Array.isArray(message.content)
	) {
		return [message];
	}

	const firstToolIndex = message.content.findIndex(
		(block) => isRecord(block) && block.type === "tool_use",
	);
	if (firstToolIndex === -1) return [message];
	const hasTrailingNonTool = message.content
		.slice(firstToolIndex)
		.some((block) => !isRecord(block) || block.type !== "tool_use");
	if (!hasTrailingNonTool) return [message];

	const toolBlocks = message.content.filter(
		(block) => isRecord(block) && block.type === "tool_use",
	);
	const otherBlocks = message.content.filter(
		(block) => !isRecord(block) || block.type !== "tool_use",
	);

	return [
		{ ...message, content: otherBlocks },
		{ ...message, content: toolBlocks },
	];
}

/** Apply only post-serialization fixes Pi does not natively provide. */
export function shapeAnthropicOAuthPayload(
	payload: unknown,
	claudeCodeVersion = getClaudeCodeVersion(),
): unknown {
	if (!isAnthropicPayload(payload)) return payload;

	const messages = payload.messages.flatMap(splitInvalidAssistantMessage);
	return {
		...payload,
		messages,
		system: shapeSystem(
			payload.system,
			billingHeader(messages, claudeCodeVersion),
		),
	};
}
