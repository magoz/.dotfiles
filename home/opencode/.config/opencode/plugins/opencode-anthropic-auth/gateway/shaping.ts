// Gateway (`subs-claude`) mode: content-only request shaping for Anthropic
// Messages requests routed through the CLIProxyAPI Claude pool (Subs gateway).
// OpenCode port of Pi's `home/pi/.pi/agent/extensions/anthropic-auth`
// (`shapeAnthropicContentPayload`). The gateway owns Claude Code identity,
// billing, betas, user-agent, system relocation and tool aliases, so nothing
// here adds any of those. Anchors verified against OpenCode 2.0.20 captures
// (see fixtures/README.md).
//
// The transforms are pure functions over parsed JSON (`unknown`, narrowed at each step); the
// one async step, `shapeGatewayHttpRequest`, is an Effect failing with GatewayShapingError.
import { Data, Effect } from "effect"

/** OpenCode providers routed through a Claude Code-impersonating gateway. */
export const ANTHROPIC_GATEWAY_PROVIDERS: readonly string[] = Object.freeze(["subs-claude"]);

// URL-level fail closed: opencode.jsonc points subs-claude at this unreachable
// loopback sentinel (discard port, nothing listens). Only a successfully shaped
// request is re-targeted to the real gateway, so a missing/broken plugin can
// never send an unshaped body.
export const SENTINEL_ORIGIN = "http://127.0.0.1:9";
export const SENTINEL_PREFIX = "/subs-claude-unshaped";
export const DEFAULT_GATEWAY_ORIGIN = "https://subs.oox.sh";
const LOOPBACK_HOSTS: readonly string[] = Object.freeze(["127.0.0.1", "localhost", "[::1]"]);
// Exact non-loopback gateway origins (compared against the normalized
// `URL.origin`, so scheme, host and port must all match; no suffix matching).
export const ALLOWED_GATEWAY_ORIGINS: readonly string[] = Object.freeze(["https://subs.oox.sh"]);

// Each anchor is OpenCode-authored text; project/user content is never
// rewritten by generic brand replacement (Pi parity: preserve project context).
const OPENCODE_INTRO =
  "You are an AI agent running in OpenCode, a coding agent harness.";
const NEUTRAL_INTRO = "You are an expert coding assistant.";
const PROSE_REPLACEMENTS = Object.freeze([
  { match: OPENCODE_INTRO, replacement: NEUTRAL_INTRO },
  { match: "\n# Harness\n", replacement: "\n# Conventions\n" },
  {
    match: "`<system-reminder>` blocks are harness instructions,",
    replacement: "`<system-reminder>` blocks are system instructions,",
  },
  {
    match:
      "Here is some useful information about the environment you are running in:",
    replacement: "Environment context you are running in:",
  },
  // Code Mode catalog namespace summary. The `tools.opencode.*` call paths stay:
  // renaming them would break tool execution.
  {
    match: "Tools for managing OpenCode itself,",
    replacement: "Tools for managing the agent itself,",
  },
]);
// `<env>` line naming OpenCode's private temp directory.
const OPENCODE_TMP_LINE =
  /^[ \t]*Prefer \S*opencode\S* over generic system temporary directories[^\n]*\n?/gm;
// Built-in skills about OpenCode itself (analogue of Pi's documentation
// paragraph). Matched by exact built-in description so user skills survive.
const BUILTIN_SKILLS = Object.freeze([
  {
    id: "opencode",
    description: "Use this skill for any question about OpenCode itself,",
  },
  {
    id: "report",
    description: "Use when the user wants to report an opencode issue or bug.",
  },
]);
const SKILL_BLOCK = /\n?[ \t]*<skill>\s*<id>([^<]*)<\/id>[\s\S]*?<\/skill>/g;

// OpenCode serializes history into a compaction checkpoint; its
// `<recent-context>` transcribes reasoning as `[Assistant reasoning]: ...`.
// That checkpoint is replayed in every later request of the session.
const CHECKPOINT_OPEN = "<conversation-checkpoint>";
const RECENT_OPEN = "<recent-context>";
const RECENT_CLOSE = "</recent-context>";
const REASONING_MARKER = "[Assistant reasoning]: ";
const TRANSCRIPT_MARKER =
  "\\[(?:User|Assistant|Assistant reasoning|Assistant tool call|Tool result|Tool error|Synthetic context|Shell)\\]: |\\[Skill activated: |\\[Attached |\\[\\d+ older exchanges? omitted\\]";
const TRANSCRIPT_BOUNDARY = new RegExp(`(?=\\n+(?:${TRANSCRIPT_MARKER}))`);
// Oversized compaction requests inline older history as a bare transcript.
const BARE_TRANSCRIPT = new RegExp(`^(?:${TRANSCRIPT_MARKER})`);

// Request headers that identify the harness; the gateway sets its own.
const HARNESS_HEADER_PREFIXES: readonly string[] = Object.freeze(["x-opencode-"]);
const HARNESS_HEADERS: readonly string[] = Object.freeze(["traceparent", "tracestate", "b3"]);

/** Strings the shaping depends on; checked against new OpenCode releases. */
export const OPENCODE_ANCHORS: readonly string[] = Object.freeze([
  OPENCODE_INTRO,
  ...PROSE_REPLACEMENTS.slice(1).map((rule) => rule.match.trim()),
  ...BUILTIN_SKILLS.map((skill) => skill.description),
  CHECKPOINT_OPEN,
  REASONING_MARKER,
]);

export class GatewayShapingError extends Data.TaggedError("GatewayShapingError")<{ readonly detail: string }> {
  override get message() {
    return `subs-claude gateway shaping failed: ${this.detail}`;
  }
}
const shapingError = (detail: string) => new GatewayShapingError({ detail });

type JsonRecord = Readonly<Record<string, unknown>>;
function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isGatewayProvider(providerID: unknown): boolean {
  return typeof providerID === "string" && ANTHROPIC_GATEWAY_PROVIDERS.includes(providerID);
}

function dropBuiltinSkills(text: string): string {
  return text.replace(SKILL_BLOCK, (block: string, id: string) =>
    BUILTIN_SKILLS.some(
      (skill) => skill.id === id.trim() && block.includes(skill.description),
    )
      ? ""
      : block,
  );
}

/** Rewrite OpenCode-authored fingerprints; leaves project context intact. */
export function shapeOpenCodeText(text: string): string {
  let shaped = text;
  for (const rule of PROSE_REPLACEMENTS) {
    shaped = shaped.split(rule.match).join(rule.replacement);
  }
  return dropBuiltinSkills(shaped.replace(OPENCODE_TMP_LINE, ""));
}

function longer(a: string, b: string): string {
  return a.length >= b.length ? a : b;
}

/** Remove `[Assistant reasoning]:` segments from an OpenCode transcript. */
export function stripReasoningSegments(transcript: string): string {
  const [, leading = "", core = "", trailing = ""] =
    /^(\n*)([\s\S]*?)(\n*)$/.exec(transcript) ?? [];
  const segments = core.split(TRANSCRIPT_BOUNDARY);
  let output = "";
  let carried = "";
  let changed = false;

  for (const segment of segments) {
    const separator = /^\n*/.exec(segment)?.[0] ?? "";
    const body = segment.slice(separator.length);
    if (body.startsWith(REASONING_MARKER)) {
      changed = true;
      // Keep the widest boundary so message breaks ("\n\n") survive.
      if (output) carried = longer(carried, separator);
      continue;
    }
    output += (output ? longer(carried, separator) : "") + body;
    carried = "";
  }

  return changed ? leading + output + trailing : transcript;
}

/** Strip transcribed reasoning inside OpenCode's checkpoint envelope only. */
export function stripCheckpointReasoning(text: string): string {
  let result = "";
  let cursor = 0;
  let checkpoint = text.indexOf(CHECKPOINT_OPEN);

  while (checkpoint !== -1) {
    const next = text.indexOf(CHECKPOINT_OPEN, checkpoint + CHECKPOINT_OPEN.length);
    const limit = next === -1 ? text.length : next;
    const open = text.indexOf(RECENT_OPEN, checkpoint);
    if (open !== -1 && open < limit) {
      const start = open + RECENT_OPEN.length;
      // Last close before the next checkpoint: transcript text may quote the tag.
      const end = text.lastIndexOf(RECENT_CLOSE, limit - RECENT_CLOSE.length);
      if (end >= start) {
        result += text.slice(cursor, start) + stripReasoningSegments(text.slice(start, end));
        cursor = end;
      }
    }
    checkpoint = next;
  }

  return cursor === 0 ? text : result + text.slice(cursor);
}

type Kind = string | undefined;

function shapeUserText(text: string, kind: Kind): string {
  const checkpointShaped = stripCheckpointReasoning(text);
  return kind === "compaction" && BARE_TRANSCRIPT.test(checkpointShaped)
    ? stripReasoningSegments(checkpointShaped)
    : checkpointShaped;
}

function shapeUserMessage(message: unknown, kind: Kind): unknown {
  if (!isRecord(message) || message.role !== "user") return message;
  if (typeof message.content === "string") {
    const content = shapeUserText(message.content, kind);
    return content === message.content ? message : { ...message, content };
  }
  if (!Array.isArray(message.content)) return message;

  let changed = false;
  const content = message.content.map((block) => {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
      return block;
    }
    const text = shapeUserText(block.text, kind);
    if (text === block.text) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? { ...message, content } : message;
}

// Pi parity (`splitInvalidAssistantMessage`): tool_use blocks must close the
// assistant turn; trailing non-tool blocks move ahead of them.
export function splitInvalidAssistantMessage(message: unknown): unknown[] {
  if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) {
    return [message];
  }
  const isTool = (block: unknown) => isRecord(block) && block["type"] === "tool_use";
  const firstTool = message.content.findIndex(isTool);
  if (firstTool === -1) return [message];
  if (message.content.slice(firstTool).every(isTool)) return [message];

  return [
    { ...message, content: message.content.filter((block) => !isTool(block)) },
    { ...message, content: message.content.filter(isTool) },
  ];
}

function shapeSystemBlock(block: unknown): unknown {
  if (typeof block === "string") return shapeOpenCodeText(block);
  if (!isRecord(block) || typeof block.text !== "string") return block;
  const text = shapeOpenCodeText(block.text);
  return text === block.text ? block : { ...block, text };
}

function shapeTool(tool: unknown): unknown {
  if (!isRecord(tool) || typeof tool.description !== "string") return tool;
  const description = shapeOpenCodeText(tool.description);
  return description === tool.description ? tool : { ...tool, description };
}

/**
 * Content-only gateway shaping of a parsed Anthropic Messages payload:
 * OpenCode prompt/tool fingerprints, checkpoint reasoning transcripts and
 * assistant text/tool ordering. Adds no billing, identity or transport data,
 * preserves the system field's shape and never mutates the input.
 */
export function shapeGatewayPayload(payload: unknown, { kind }: { readonly kind?: Kind } = {}): JsonRecord {
  if (!isRecord(payload) || !Array.isArray(payload["messages"])) {
    throw shapingError("body is not an Anthropic Messages payload");
  }

  const messages = payload["messages"]
    .map((message: unknown) => shapeUserMessage(message, kind))
    .flatMap(splitInvalidAssistantMessage);
  const shaped: Record<string, unknown> = { ...payload, messages };
  const tools = payload["tools"];
  const system = payload["system"];
  if (Array.isArray(tools)) shaped["tools"] = tools.map(shapeTool);
  if (typeof system === "string") shaped["system"] = shapeOpenCodeText(system);
  if (Array.isArray(system)) shaped["system"] = system.map(shapeSystemBlock);
  return shaped;
}

/** Parse, shape and re-serialize a request body; throws instead of passing through. */
export function shapeGatewayBody(body: string, options?: { readonly kind?: Kind }): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw shapingError(
      `body is not JSON (${cause instanceof Error ? cause.message : "parse error"})`,
    );
  }
  return JSON.stringify(shapeGatewayPayload(parsed, options));
}

/** Remove harness-identifying headers in place. Adds nothing. */
export function stripHarnessHeaders(headers: Headers): Headers {
  const names: string[] = [];
  headers.forEach((_, name) => names.push(name));
  for (const name of names) {
    const lower = name.toLowerCase();
    if (
      HARNESS_HEADERS.includes(lower) ||
      HARNESS_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))
    ) {
      headers.delete(name);
    }
  }
  return headers;
}

/**
 * Validate the real gateway origin. It must be a bare origin (no path,
 * search, hash or userinfo) that is either a loopback http(s) origin (tests and
 * `OPENCODE_SUBS_CLAUDE_GATEWAY_ORIGIN` overrides) or exactly one of
 * ALLOWED_GATEWAY_ORIGINS (`https://subs.oox.sh`, default port only).
 */
export function parseGatewayOrigin(value: string = DEFAULT_GATEWAY_ORIGIN): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw shapingError(`invalid gateway origin ${JSON.stringify(value)}`);
  }
  const bare =
    url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  const loopback =
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOOPBACK_HOSTS.includes(url.hostname);
  const allowlisted = ALLOWED_GATEWAY_ORIGINS.includes(url.origin);
  if (!bare || !(loopback || allowlisted)) {
    throw shapingError(
      `gateway origin must be a bare loopback origin or one of ${ALLOWED_GATEWAY_ORIGINS.join(", ")}, got ${value}`,
    );
  }
  return url.origin;
}

/**
 * Map a sentinel URL (`http://127.0.0.1:9/subs-claude-unshaped/v1/messages`)
 * to the gateway (`<origin>/v1/messages`). Any other URL is left untouched.
 */
export function gatewayURL(requestURL: string, gatewayOrigin: string): string {
  const url = new URL(requestURL);
  if (url.origin !== SENTINEL_ORIGIN || !url.pathname.startsWith(`${SENTINEL_PREFIX}/`)) {
    return requestURL;
  }
  const target = new URL(gatewayOrigin);
  target.pathname = url.pathname.slice(SENTINEL_PREFIX.length);
  target.search = url.search;
  return target.toString();
}

/** The `http.request` hook event fields shaping reads and replaces (OpenCode's event satisfies it). */
export interface HttpRequestEvent {
  readonly kind?: string | undefined;
  readonly model: { readonly providerID: string };
  request: Request;
}

/**
 * `http.request` hook body. Replaces `event.request` with a shaped copy aimed
 * at the gateway; any failure fails the Effect (and the sentinel URL stays in
 * place) so OpenCode fails the request rather than sending an unshaped body.
 */
export const shapeGatewayHttpRequest = (
  event: HttpRequestEvent,
  { gatewayOrigin = DEFAULT_GATEWAY_ORIGIN }: { readonly gatewayOrigin?: string | undefined } = {},
): Effect.Effect<void, GatewayShapingError> =>
  Effect.gen(function* () {
    if (!isGatewayProvider(event.model.providerID)) return;
    const request = event.request;
    if (!(request instanceof Request)) return yield* shapingError("http.request event has no Request");

    const shape = <A>(f: () => A) =>
      Effect.try({ try: f, catch: (cause) => (cause instanceof GatewayShapingError ? cause : shapingError(String(cause))) });
    const headers = stripHarnessHeaders(new Headers(request.headers));
    const text = request.body
      ? yield* Effect.tryPromise({ try: () => request.clone().text(), catch: () => shapingError("request body unreadable") })
      : undefined;
    const body = text === undefined ? undefined : yield* shape(() => shapeGatewayBody(text, { kind: event.kind }));
    if (body !== undefined) headers.delete("content-length");
    // Re-target last: only reached once shaping succeeded.
    const target = yield* shape(() => gatewayURL(request.url, parseGatewayOrigin(gatewayOrigin)));
    event.request = new Request(target, { method: request.method, headers, ...(body === undefined ? {} : { body }), signal: request.signal });
  });

// Only Anthropic thinking can be replayed natively. Other providers' opaque
// reasoning (OpenAI `encrypted` content, foreign metadata) is lowered to text.
function hasReplayableReasoning(part: JsonRecord): boolean {
  const metadata = isRecord(part["providerMetadata"]) ? part["providerMetadata"]["anthropic"] : undefined;
  return (
    isRecord(metadata) &&
    ((typeof metadata["signature"] === "string" && metadata["signature"].trim() !== "") ||
      (typeof metadata["redactedData"] === "string" && metadata["redactedData"] !== ""))
  );
}

/**
 * Semantic hook event fields (`context`/`compaction`/`generate`/`title`). Messages are the host's
 * own class instances: their `content` is edited in place, never rebuilt, so their identity stays.
 */
export interface SemanticEvent {
  readonly model: { readonly providerID: string };
  messages: Array<{ readonly role: string; content: ReadonlyArray<unknown> }>;
}

/**
 * Semantic-hook body. OpenCode lowers reasoning without an Anthropic signature
 * (e.g. history from another provider) to plain assistant text, which would
 * transcribe model reasoning. Drop those parts before lowering; signed/redacted
 * thinking is kept.
 */
export function dropUnreplayableReasoning(event: SemanticEvent): void {
  if (!isGatewayProvider(event.model.providerID)) return;
  if (!Array.isArray(event.messages)) return;

  for (let index = event.messages.length - 1; index >= 0; index--) {
    const message = event.messages[index];
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const content = message.content.filter(
      (part) => !isRecord(part) || part["type"] !== "reasoning" || hasReplayableReasoning(part),
    );
    if (content.length === message.content.length) continue;
    if (content.length === 0) event.messages.splice(index, 1);
    else message.content = content;
  }
}
