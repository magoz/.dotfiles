import type {
  ExtensionAPI,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

const LOOKUP_TOOL_NAME = "session_context_lookup";
const MAX_LOOKUPS_PER_COMPACTION = 2;
const MAX_RESULTS = 4;
const MAX_EXCERPT_CHARS = 760;
const MAX_OUTPUT_CHARS = 4_000;

const CONTINUATION_PROMPT = `Continue the unfinished task using the compaction summary, retained context, and current worktree.

Do not recap or inspect session history. Only if one specific critical fact missing from the summary blocks the immediate next action, use session_context_lookup once with a narrow question. Never inspect PI_SESSION_FILE directly for context recovery. If the task is already complete, say so briefly.`;

const LOOKUP_PURPOSES = [
  "missing_constraint",
  "missing_decision",
  "exact_error",
  "previous_next_step",
] as const;

type LookupPurpose = (typeof LOOKUP_PURPOSES)[number];

const LookupParameters = Type.Object({
  purpose: StringEnum(LOOKUP_PURPOSES, {
    description: "The specific kind of critical fact missing from the compacted context.",
  }),
  question: Type.String({
    minLength: 10,
    maxLength: 240,
    description: "One narrow question whose answer is required for the immediate next action.",
  }),
  keywords: Type.Array(
    Type.String({ minLength: 2, maxLength: 64 }),
    {
      minItems: 1,
      maxItems: 5,
      description: "One to five specific terms likely to occur in the missing evidence. Do not use generic terms such as context or history.",
    },
  ),
});

type LookupInput = Static<typeof LookupParameters>;

interface LookupDetails {
  purpose: LookupPurpose;
  question: string;
  keywords: string[];
  resultCount: number;
  entryIds: string[];
  refusedReason?:
    | "no_compaction"
    | "boundary_unavailable"
    | "rate_limit"
    | "vague_query"
    | "no_match";
}

interface SearchableEntry {
  entry: SessionEntry;
  source: string;
  text: string;
  index: number;
}

interface RankedEntry extends SearchableEntry {
  score: number;
}

const VAGUE_KEYWORDS = new Set([
  "all",
  "anything",
  "context",
  "conversation",
  "everything",
  "history",
  "session",
  "summary",
  "tree",
  "what happened",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function redactSensitive(value: string): string {
  return value
    .replace(/(https?:\/\/)([^/\s@]+)@/gi, "$1[REDACTED]@")
    .replace(/(\bauthorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /(\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTH)[A-Z0-9_]*=)[^\s]+/g,
      "$1[REDACTED]",
    )
    .replace(
      /((?:api[_-]?key|token|secret|password|authorization)\s*["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function safeText(value: string): string {
  return normalizeWhitespace(redactSensitive(value));
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function assistantEvidence(message: SessionMessageEntry["message"]): string {
  if (message.role !== "assistant") return "";

  const evidence = [textContent(message.content)];
  if (message.stopReason === "error" && message.errorMessage) {
    evidence.push(`Error: ${message.errorMessage}`);
  }

  for (const block of message.content) {
    if (block.type !== "toolCall") continue;

    if (
      block.name === "bash" &&
      typeof block.arguments === "object" &&
      block.arguments !== null &&
      "command" in block.arguments &&
      typeof block.arguments.command === "string"
    ) {
      evidence.push(`Tool call bash command: ${block.arguments.command}`);
      continue;
    }

    if (
      typeof block.arguments === "object" &&
      block.arguments !== null &&
      "path" in block.arguments &&
      typeof block.arguments.path === "string"
    ) {
      evidence.push(`Tool call ${block.name} path: ${block.arguments.path}`);
      continue;
    }

    evidence.push(`Tool call: ${block.name}`);
  }

  return evidence.join("\n");
}

function searchableMessage(entry: SessionMessageEntry, index: number): SearchableEntry | undefined {
  const { message } = entry;

  switch (message.role) {
    case "user":
      return {
        entry,
        source: "user",
        text: safeText(textContent(message.content)),
        index,
      };
    case "assistant":
      return {
        entry,
        source: "assistant",
        // Deliberately exclude thinking and reasoning replay state. Only visible
        // text, provider errors, and bounded tool-call identifiers are searchable.
        text: safeText(assistantEvidence(message)),
        index,
      };
    case "toolResult":
      return {
        entry,
        source: `tool result (${message.toolName})`,
        text: safeText(textContent(message.content)),
        index,
      };
    case "bashExecution":
      return {
        entry,
        source: "user bash",
        text: safeText(`Command: ${message.command}\nOutput: ${message.output}`),
        index,
      };
    case "custom":
      return {
        entry,
        source: `custom message (${message.customType})`,
        text: safeText(textContent(message.content)),
        index,
      };
    default:
      return undefined;
  }
}

function searchableEntry(entry: SessionEntry, index: number): SearchableEntry | undefined {
  if (entry.type === "message") return searchableMessage(entry, index);

  if (entry.type === "custom_message") {
    return {
      entry,
      source: `custom message (${entry.customType})`,
      text: safeText(textContent(entry.content)),
      index,
    };
  }

  if (entry.type === "branch_summary") {
    return {
      entry,
      source: "branch summary",
      text: safeText(entry.summary),
      index,
    };
  }

  return undefined;
}

function sourceWeight(purpose: LookupPurpose, source: string): number {
  switch (purpose) {
    case "missing_constraint":
      return source === "user" ? 4 : source === "assistant" ? 2 : 0;
    case "missing_decision":
      return source === "assistant" || source === "user" ? 3 : 0;
    case "exact_error":
      return source.startsWith("tool result") || source === "user bash" ? 4 : 1;
    case "previous_next_step":
      return source === "assistant" ? 4 : source === "user" ? 2 : 0;
  }
}

function normalizedKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map((keyword) => normalizeWhitespace(keyword).toLowerCase()).filter(Boolean))];
}

function isVagueQuery(keywords: string[]): boolean {
  return keywords.length === 0 || keywords.every((keyword) => VAGUE_KEYWORDS.has(keyword));
}

function rankEntries(
  entries: SessionEntry[],
  purpose: LookupPurpose,
  keywords: string[],
): RankedEntry[] {
  const ranked: RankedEntry[] = [];

  for (let index = 0; index < entries.length; index++) {
    const candidate = searchableEntry(entries[index]!, index);
    if (!candidate?.text) continue;

    const haystack = candidate.text.toLowerCase();
    const matched = keywords.filter((keyword) => haystack.includes(keyword));
    if (matched.length === 0) continue;

    const score =
      matched.reduce((total, keyword) => {
        const occurrences = haystack.split(keyword).length - 1;
        return total + Math.min(occurrences, 3) * 4 + (keyword.includes(" ") ? 3 : 0);
      }, 0) +
      (matched.length === keywords.length ? 6 : 0) +
      sourceWeight(purpose, candidate.source);

    ranked.push({ ...candidate, score });
  }

  return ranked
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, MAX_RESULTS);
}

function excerptAroundMatch(text: string, keywords: string[]): string {
  if (text.length <= MAX_EXCERPT_CHARS) return text;

  const lower = text.toLowerCase();
  const matchIndexes = keywords
    .map((keyword) => lower.indexOf(keyword))
    .filter((index) => index >= 0);
  const matchIndex = matchIndexes.length > 0 ? Math.min(...matchIndexes) : 0;
  const start = Math.max(0, matchIndex - Math.floor(MAX_EXCERPT_CHARS / 3));
  const end = Math.min(text.length, start + MAX_EXCERPT_CHARS);

  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function boundedOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS - 20).trimEnd()}\n[output capped]`;
}

function refusal(
  input: LookupInput,
  refusedReason: LookupDetails["refusedReason"],
  text: string,
) {
  return {
    content: [{ type: "text" as const, text }],
    details: {
      purpose: input.purpose,
      question: input.question,
      keywords: input.keywords,
      resultCount: 0,
      entryIds: [],
      refusedReason,
    } satisfies LookupDetails,
  };
}

function persistedLookupCount(entries: SessionEntry[], compactionIndex: number): number {
  return entries.slice(compactionIndex + 1).filter(
    (entry) =>
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.toolName === LOOKUP_TOOL_NAME,
  ).length;
}

export default function continueAfterCompaction(pi: ExtensionAPI): void {
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const inMemoryLookupCounts = new Map<string, number>();

  const setLookupActive = (active: boolean) => {
    const current = pi.getActiveTools();
    const withoutLookup = current.filter((name) => name !== LOOKUP_TOOL_NAME);
    pi.setActiveTools(active ? [...withoutLookup, LOOKUP_TOOL_NAME] : withoutLookup);
  };

  pi.registerTool({
    name: LOOKUP_TOOL_NAME,
    label: "Session Context Lookup",
    description:
      "Recover one specific critical fact missing after compaction from compacted-away entries on the current active branch. This is not a history browser: do not use it for routine continuation, recaps, broad reconstruction, current repository state, or confirmation. It returns at most four reasoning-stripped, credential-redacted excerpts capped at 4KB, has no pagination, and permits at most two calls per compaction.",
    promptGuidelines: [
      "Use session_context_lookup only when one specific critical fact missing from the compaction summary blocks the immediate next action.",
      "Do not use session_context_lookup for routine continuation, recaps, broad history review, current repository state, confirmation, or repeated searches for confidence.",
      "Never inspect PI_SESSION_FILE directly for context recovery; ask session_context_lookup one narrow question with specific keywords and accept its bounded result.",
    ],
    parameters: LookupParameters,

    async execute(_toolCallId, input, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        return refusal(input, "no_match", "Session context lookup was cancelled.");
      }

      const branch = ctx.sessionManager.getBranch();
      let compactionIndex = -1;
      for (let index = branch.length - 1; index >= 0; index--) {
        if (branch[index]?.type === "compaction") {
          compactionIndex = index;
          break;
        }
      }

      if (compactionIndex < 0) {
        return refusal(
          input,
          "no_compaction",
          "No compaction checkpoint exists on the current active branch. Use the retained conversation and current worktree instead.",
        );
      }

      const compaction = branch[compactionIndex]!;
      if (compaction.type !== "compaction") {
        return refusal(
          input,
          "boundary_unavailable",
          "The latest compaction boundary could not be resolved. Continue from the compaction summary and current worktree instead of broadening the lookup.",
        );
      }

      const firstKeptIndex = branch.findIndex(
        (entry, index) => index < compactionIndex && entry.id === compaction.firstKeptEntryId,
      );
      if (firstKeptIndex < 0) {
        return refusal(
          input,
          "boundary_unavailable",
          "The compacted-away history boundary is unavailable. Continue from the compaction summary and current worktree instead of searching retained or unrelated entries.",
        );
      }

      const persistedCount = persistedLookupCount(branch, compactionIndex);
      const inMemoryCount = inMemoryLookupCounts.get(compaction.id) ?? 0;
      const lookupCount = Math.max(persistedCount, inMemoryCount);

      if (lookupCount >= MAX_LOOKUPS_PER_COMPACTION) {
        return refusal(
          input,
          "rate_limit",
          "Session context lookup is limited to two calls per compaction. Continue from the bounded evidence already returned, the compaction summary, and the current worktree; ask the user if an essential fact remains unresolved.",
        );
      }
      inMemoryLookupCounts.set(compaction.id, lookupCount + 1);

      const keywords = normalizedKeywords(input.keywords);
      if (isVagueQuery(keywords)) {
        return refusal(
          input,
          "vague_query",
          "Session context lookup requires specific evidence terms. It cannot retrieve general context, history, summaries, or everything that happened. Continue from the compaction summary or retry only if one narrow missing fact blocks progress.",
        );
      }

      const matches = rankEntries(branch.slice(0, firstKeptIndex), input.purpose, keywords);
      if (matches.length === 0) {
        return refusal(
          input,
          "no_match",
          "No bounded evidence was found for that specific question. Continue from the compaction summary and current worktree, or ask the user if the fact is essential. Do not broaden the lookup into a history reconstruction.",
        );
      }

      const lines = [
        `Recovered ${matches.length} bounded evidence excerpt${matches.length === 1 ? "" : "s"} for ${input.purpose}.`,
        "These excerpts are not a complete transcript and may be stale; reconcile them with the current worktree.",
      ];

      for (const [index, match] of matches.entries()) {
        lines.push(
          "",
          `[${index + 1}] ${match.source} · ${match.entry.timestamp} · entry ${match.entry.id}`,
          excerptAroundMatch(match.text, keywords),
        );
      }

      return {
        content: [{ type: "text" as const, text: boundedOutput(lines.join("\n")) }],
        details: {
          purpose: input.purpose,
          question: input.question,
          keywords: input.keywords,
          resultCount: matches.length,
          entryIds: matches.map((match) => match.entry.id),
        } satisfies LookupDetails,
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    setLookupActive(ctx.sessionManager.getBranch().some((entry) => entry.type === "compaction"));
  });

  pi.on("session_tree", (_event, ctx) => {
    setLookupActive(ctx.sessionManager.getBranch().some((entry) => entry.type === "compaction"));
  });

  pi.on("session_compact", (event) => {
    setLookupActive(true);
    if (event.willRetry) return;

    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      pi.sendUserMessage(CONTINUATION_PROMPT, { deliverAs: "followUp" });
    }, 0);

    pendingTimers.add(timer);
  });

  pi.on("session_shutdown", () => {
    for (const timer of pendingTimers) clearTimeout(timer);
    pendingTimers.clear();
    inMemoryLookupCounts.clear();
  });
}
