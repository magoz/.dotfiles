// Gateway (`subs-claude`) mode: content-only request shaping for Anthropic
// Messages requests routed through the local CLIProxyAPI Claude pool.
// OpenCode port of Pi's `home/pi/.pi/agent/extensions/anthropic-auth`
// (`shapeAnthropicContentPayload`). The gateway owns Claude Code identity,
// billing, betas, user-agent, system relocation and tool aliases, so nothing
// here adds any of those. Anchors verified against OpenCode 2.0.20 captures
// (see fixtures/README.md).

/** OpenCode providers routed through a Claude Code-impersonating gateway. */
export const ANTHROPIC_GATEWAY_PROVIDERS = Object.freeze(["subs-claude"]);

// URL-level fail closed: opencode.jsonc points subs-claude at this unreachable
// loopback sentinel (discard port, nothing listens). Only a successfully shaped
// request is re-targeted to the real gateway, so a missing/broken plugin can
// never send an unshaped body.
export const SENTINEL_ORIGIN = "http://127.0.0.1:9";
export const SENTINEL_PREFIX = "/subs-claude-unshaped";
export const DEFAULT_GATEWAY_ORIGIN = "http://127.0.0.1:8317";
const LOOPBACK_HOSTS = Object.freeze(["127.0.0.1", "localhost", "[::1]"]);

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
const HARNESS_HEADER_PREFIXES = Object.freeze(["x-opencode-"]);
const HARNESS_HEADERS = Object.freeze(["traceparent", "tracestate", "b3"]);

/** Strings the shaping depends on; checked against new OpenCode releases. */
export const OPENCODE_ANCHORS = Object.freeze([
  OPENCODE_INTRO,
  ...PROSE_REPLACEMENTS.slice(1).map((rule) => rule.match.trim()),
  ...BUILTIN_SKILLS.map((skill) => skill.description),
  CHECKPOINT_OPEN,
  REASONING_MARKER,
]);

export class GatewayShapingError extends Error {
  constructor(message) {
    super(`subs-claude gateway shaping failed: ${message}`);
    this.name = "GatewayShapingError";
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isGatewayProvider(providerID) {
  return ANTHROPIC_GATEWAY_PROVIDERS.includes(providerID);
}

function dropBuiltinSkills(text) {
  return text.replace(SKILL_BLOCK, (block, id) =>
    BUILTIN_SKILLS.some(
      (skill) => skill.id === id.trim() && block.includes(skill.description),
    )
      ? ""
      : block,
  );
}

/** Rewrite OpenCode-authored fingerprints; leaves project context intact. */
export function shapeOpenCodeText(text) {
  let shaped = text;
  for (const rule of PROSE_REPLACEMENTS) {
    shaped = shaped.split(rule.match).join(rule.replacement);
  }
  return dropBuiltinSkills(shaped.replace(OPENCODE_TMP_LINE, ""));
}

function longer(a, b) {
  return a.length >= b.length ? a : b;
}

/** Remove `[Assistant reasoning]:` segments from an OpenCode transcript. */
export function stripReasoningSegments(transcript) {
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
export function stripCheckpointReasoning(text) {
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

function shapeUserText(text, kind) {
  const checkpointShaped = stripCheckpointReasoning(text);
  return kind === "compaction" && BARE_TRANSCRIPT.test(checkpointShaped)
    ? stripReasoningSegments(checkpointShaped)
    : checkpointShaped;
}

function shapeUserMessage(message, kind) {
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
export function splitInvalidAssistantMessage(message) {
  if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) {
    return [message];
  }
  const isTool = (block) => isRecord(block) && block.type === "tool_use";
  const firstTool = message.content.findIndex(isTool);
  if (firstTool === -1) return [message];
  if (message.content.slice(firstTool).every(isTool)) return [message];

  return [
    { ...message, content: message.content.filter((block) => !isTool(block)) },
    { ...message, content: message.content.filter(isTool) },
  ];
}

function shapeSystemBlock(block) {
  if (typeof block === "string") return shapeOpenCodeText(block);
  if (!isRecord(block) || typeof block.text !== "string") return block;
  const text = shapeOpenCodeText(block.text);
  return text === block.text ? block : { ...block, text };
}

function shapeTool(tool) {
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
export function shapeGatewayPayload(payload, { kind } = {}) {
  if (!isRecord(payload) || !Array.isArray(payload.messages)) {
    throw new GatewayShapingError("body is not an Anthropic Messages payload");
  }

  const messages = payload.messages
    .map((message) => shapeUserMessage(message, kind))
    .flatMap(splitInvalidAssistantMessage);
  const shaped = { ...payload, messages };
  if (Array.isArray(payload.tools)) shaped.tools = payload.tools.map(shapeTool);
  if (typeof payload.system === "string") shaped.system = shapeOpenCodeText(payload.system);
  if (Array.isArray(payload.system)) shaped.system = payload.system.map(shapeSystemBlock);
  return shaped;
}

/** Parse, shape and re-serialize a request body; throws instead of passing through. */
export function shapeGatewayBody(body, options) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new GatewayShapingError(
      `body is not JSON (${cause instanceof Error ? cause.message : "parse error"})`,
    );
  }
  return JSON.stringify(shapeGatewayPayload(parsed, options));
}

/** Remove harness-identifying headers in place. Adds nothing. */
export function stripHarnessHeaders(headers) {
  for (const name of [...headers.keys()]) {
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

/** Validate the real gateway origin: loopback http(s) only, no path. */
export function parseGatewayOrigin(value = DEFAULT_GATEWAY_ORIGIN) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GatewayShapingError(`invalid gateway origin ${JSON.stringify(value)}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !LOOPBACK_HOSTS.includes(url.hostname) ||
    url.pathname !== "/" ||
    url.search ||
    url.username ||
    url.password
  ) {
    throw new GatewayShapingError(`gateway origin must be a bare loopback origin, got ${value}`);
  }
  return url.origin;
}

/**
 * Map a sentinel URL (`http://127.0.0.1:9/subs-claude-unshaped/v1/messages`)
 * to the gateway (`<origin>/v1/messages`). Any other URL is left untouched.
 */
export function gatewayURL(requestURL, gatewayOrigin) {
  const url = new URL(requestURL);
  if (url.origin !== SENTINEL_ORIGIN || !url.pathname.startsWith(`${SENTINEL_PREFIX}/`)) {
    return requestURL;
  }
  const target = new URL(gatewayOrigin);
  target.pathname = url.pathname.slice(SENTINEL_PREFIX.length);
  target.search = url.search;
  return target.toString();
}

/**
 * `http.request` hook body. Replaces `event.request` with a shaped copy aimed
 * at the gateway; any failure throws (and the sentinel URL stays in place) so
 * OpenCode fails the request rather than sending an unshaped body.
 */
export async function shapeGatewayHttpRequest(event, { gatewayOrigin = DEFAULT_GATEWAY_ORIGIN } = {}) {
  if (!isRecord(event) || !isRecord(event.model) || !isGatewayProvider(event.model.providerID)) {
    return;
  }
  const request = event.request;
  if (!(request instanceof Request)) {
    throw new GatewayShapingError("http.request event has no Request");
  }

  const headers = stripHarnessHeaders(new Headers(request.headers));
  const body = request.body
    ? shapeGatewayBody(await request.clone().text(), { kind: event.kind })
    : undefined;
  if (body !== undefined) headers.delete("content-length");
  // Re-target last: only reached once shaping succeeded.
  event.request = new Request(gatewayURL(request.url, parseGatewayOrigin(gatewayOrigin)), {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  });
}

// Only Anthropic thinking can be replayed natively. Other providers' opaque
// reasoning (OpenAI `encrypted` content, foreign metadata) is lowered to text.
function hasReplayableReasoning(part) {
  const metadata = isRecord(part.providerMetadata) ? part.providerMetadata.anthropic : undefined;
  return (
    isRecord(metadata) &&
    ((typeof metadata.signature === "string" && metadata.signature.trim() !== "") ||
      (typeof metadata.redactedData === "string" && metadata.redactedData !== ""))
  );
}

/**
 * Semantic-hook body (`context`/`compaction`/`generate`/`title`). OpenCode
 * lowers reasoning without an Anthropic signature (e.g. history from another
 * provider) to plain assistant text, which would transcribe model reasoning.
 * Drop those parts before lowering; signed/redacted thinking is kept.
 */
export function dropUnreplayableReasoning(event) {
  if (!isRecord(event) || !isRecord(event.model) || !isGatewayProvider(event.model.providerID)) {
    return;
  }
  if (!Array.isArray(event.messages)) return;

  for (let index = event.messages.length - 1; index >= 0; index--) {
    const message = event.messages[index];
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    const content = message.content.filter(
      (part) => !isRecord(part) || part.type !== "reasoning" || hasReplayableReasoning(part),
    );
    if (content.length === message.content.length) continue;
    if (content.length === 0) event.messages.splice(index, 1);
    else message.content = content;
  }
}
