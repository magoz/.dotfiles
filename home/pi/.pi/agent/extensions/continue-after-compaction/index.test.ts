import assert from "node:assert/strict";
import test from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import register from "./index.ts";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  details: {
    resultCount: number;
    entryIds: string[];
    refusedReason?: string;
  };
};

type LookupInput = {
  purpose: "missing_constraint" | "missing_decision" | "exact_error" | "previous_next_step";
  question: string;
  keywords: string[];
};

type RegisteredTool = {
  name: string;
  description: string;
  promptGuidelines?: string[];
  execute(
    toolCallId: string,
    input: LookupInput,
    signal: AbortSignal,
    onUpdate: () => void,
    ctx: { sessionManager: { getBranch(): SessionEntry[] } },
  ): Promise<ToolResult>;
};

type EventContext = { sessionManager: { getBranch(): SessionEntry[] } };

type EventHandler = (
  event: {
    reason?: "manual" | "threshold" | "overflow";
    willRetry?: boolean;
  },
  ctx?: EventContext,
) => void;

function entry(value: unknown): SessionEntry {
  return value as SessionEntry;
}

function retainedEntry(id = "retained-message"): SessionEntry {
  return entry({
    type: "message",
    id,
    parentId: "before-compaction",
    timestamp: "2026-08-01T10:02:00.000Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "This recent message remains in native context." }],
      timestamp: 3,
    },
  });
}

function compaction(id = "compact-1", firstKeptEntryId = "retained-message"): SessionEntry {
  return entry({
    type: "compaction",
    id,
    parentId: firstKeptEntryId,
    timestamp: "2026-08-01T10:03:00.000Z",
    summary: "A compact summary",
    firstKeptEntryId,
    tokensBefore: 250_000,
  });
}

function setup(branch: SessionEntry[]) {
  let tool: RegisteredTool | undefined;
  const handlers = new Map<string, EventHandler>();
  const sent: Array<{ content: string; options: { deliverAs: string } }> = [];
  let activeTools = ["read"];

  register({
    registerTool(definition: RegisteredTool) {
      tool = definition;
      activeTools = [...activeTools, definition.name];
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(names: string[]) {
      activeTools = [...names];
    },
    on(name: string, handler: EventHandler) {
      handlers.set(name, handler);
    },
    sendUserMessage(content: string, options: { deliverAs: string }) {
      sent.push({ content, options });
    },
  } as never);

  assert.ok(tool);
  return {
    tool,
    handlers,
    sent,
    activeTools: () => [...activeTools],
    ctx: { sessionManager: { getBranch: () => branch } },
  };
}

const signal = new AbortController().signal;
const update = () => {};

test("registers an explicitly narrow recovery tool", () => {
  const { tool } = setup([compaction()]);

  assert.equal(tool.name, "session_context_lookup");
  assert.match(tool.description, /not a history browser/i);
  assert.match(tool.description, /4KB/);
  assert.ok(tool.promptGuidelines?.some((line) => /routine continuation/i.test(line)));
  assert.ok(tool.promptGuidelines?.some((line) => /Never inspect PI_SESSION_FILE/i.test(line)));
});

test("returns bounded visible evidence without thinking or signatures", async () => {
  const longPrefix = "irrelevant ".repeat(600);
  const branch = [
    entry({
      type: "message",
      id: "user-constraint",
      parentId: null,
      timestamp: "2026-08-01T10:00:00.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: `${longPrefix}Migration must preserve invoice IDs exactly.` }],
        timestamp: 1,
      },
    }),
    entry({
      type: "message",
      id: "assistant-decision",
      parentId: "user-constraint",
      timestamp: "2026-08-01T10:01:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "SECRET INTERNAL REASONING",
            thinkingSignature: "ENCRYPTED_SIGNATURE_SHOULD_NOT_APPEAR",
          },
          { type: "text", text: "Decision: use a transactional migration for invoice IDs." },
        ],
        provider: "test",
        model: "test",
        usage: {},
        stopReason: "stop",
        timestamp: 2,
      },
    }),
    retainedEntry(),
    compaction(),
  ];
  const { tool, ctx } = setup(branch);

  const result = await tool.execute(
    "call-1",
    {
      purpose: "missing_constraint",
      question: "What exact invoice migration constraint did the user specify?",
      keywords: ["invoice IDs", "migration"],
    },
    signal,
    update,
    ctx,
  );

  const output = result.content[0]?.text ?? "";
  assert.match(output, /preserve invoice IDs exactly/);
  assert.match(output, /transactional migration/);
  assert.doesNotMatch(output, /SECRET INTERNAL REASONING/);
  assert.doesNotMatch(output, /ENCRYPTED_SIGNATURE/);
  assert.ok(output.length <= 4_000);
  assert.equal(result.details.resultCount, 2);
  assert.deepEqual(result.details.entryIds, ["user-constraint", "assistant-decision"]);
});

test("searches only compacted-away entries, not the retained tail", async () => {
  const branch = [
    entry({
      type: "message",
      id: "old-invoice-decision",
      parentId: null,
      timestamp: "2026-08-01T10:00:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Old compacted invoice decision: preserve identifiers." }],
        provider: "test",
        model: "test",
        usage: {},
        stopReason: "stop",
        timestamp: 1,
      },
    }),
    entry({
      type: "message",
      id: "retained-message",
      parentId: "old-invoice-decision",
      timestamp: "2026-08-01T10:02:00.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Current retained invoice evidence must not be duplicated." }],
        timestamp: 2,
      },
    }),
    compaction(),
  ];
  const { tool, ctx } = setup(branch);

  const result = await tool.execute(
    "call-boundary",
    {
      purpose: "missing_decision",
      question: "What compacted invoice decision was previously made?",
      keywords: ["invoice"],
    },
    signal,
    update,
    ctx,
  );

  const output = result.content[0]?.text ?? "";
  assert.match(output, /Old compacted invoice decision/);
  assert.doesNotMatch(output, /Current retained invoice evidence/);
  assert.deepEqual(result.details.entryIds, ["old-invoice-decision"]);
});

test("recovers exact provider errors and the command that produced them", async () => {
  const branch = [
    entry({
      type: "message",
      id: "assistant-error",
      parentId: null,
      timestamp: "2026-08-01T10:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "bash",
            arguments: { command: "API_TOKEN=supersecret pnpm test --filter invoice" },
          },
        ],
        provider: "test",
        model: "test",
        usage: {},
        stopReason: "error",
        errorMessage: "EADDRINUSE while starting the invoice test server",
        timestamp: 1,
      },
    }),
    retainedEntry(),
    compaction(),
  ];
  const { tool, ctx } = setup(branch);

  const result = await tool.execute(
    "call-error",
    {
      purpose: "exact_error",
      question: "Which invoice test command failed and what was the exact error?",
      keywords: ["invoice", "EADDRINUSE"],
    },
    signal,
    update,
    ctx,
  );

  const output = result.content[0]?.text ?? "";
  assert.match(output, /API_TOKEN=\[REDACTED\] pnpm test --filter invoice/);
  assert.match(output, /EADDRINUSE while starting the invoice test server/);
  assert.doesNotMatch(output, /supersecret/);
});

test("rejects broad history-reconstruction queries", async () => {
  const { tool, ctx } = setup([retainedEntry(), compaction()]);
  const result = await tool.execute(
    "call-vague",
    {
      purpose: "previous_next_step",
      question: "What happened in the conversation before compaction?",
      keywords: ["context", "history"],
    },
    signal,
    update,
    ctx,
  );

  assert.equal(result.details.refusedReason, "vague_query");
  assert.match(result.content[0]?.text ?? "", /cannot retrieve general context/i);
});

test("limits recovery to two calls per compaction", async () => {
  const branch = [
    entry({
      type: "message",
      id: "evidence",
      parentId: null,
      timestamp: "2026-08-01T10:00:00.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Preserve invoice IDs." }],
        timestamp: 1,
      },
    }),
    retainedEntry(),
    compaction(),
  ];
  const { tool, ctx } = setup(branch);
  const input: LookupInput = {
    purpose: "missing_constraint",
    question: "What invoice identifier constraint must be preserved?",
    keywords: ["invoice IDs"],
  };

  const first = await tool.execute("call-1", input, signal, update, ctx);
  const second = await tool.execute("call-2", input, signal, update, ctx);
  const third = await tool.execute("call-3", input, signal, update, ctx);

  assert.equal(first.details.resultCount, 1);
  assert.equal(second.details.resultCount, 1);
  assert.equal(third.details.refusedReason, "rate_limit");
});

test("activates the recovery tool only on branches with compaction", () => {
  const branch = [retainedEntry()];
  const { handlers, activeTools, ctx } = setup(branch);
  const onStart = handlers.get("session_start");
  const onTree = handlers.get("session_tree");
  assert.ok(onStart);
  assert.ok(onTree);

  onStart({}, ctx);
  assert.deepEqual(activeTools(), ["read"]);

  branch.push(compaction());
  onTree({}, ctx);
  assert.deepEqual(activeTools(), ["read", "session_context_lookup"]);
});

test("skips only overflow compactions that native Pi retries", async () => {
  const { handlers, sent } = setup([compaction()]);
  const onCompact = handlers.get("session_compact");
  assert.ok(onCompact);

  onCompact({ reason: "overflow", willRetry: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sent.length, 0);

  onCompact({ reason: "overflow", willRetry: false });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sent.length, 1);

  onCompact({ reason: "threshold", willRetry: false });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(sent.length, 2);
  assert.equal(sent[0]?.options.deliverAs, "followUp");
  assert.match(sent[0]?.content ?? "", /session_context_lookup once/);
  assert.match(sent[0]?.content ?? "", /Never inspect PI_SESSION_FILE directly/);
  assert.doesNotMatch(sent[0]?.content ?? "", /persisted session JSONL/i);
  assert.doesNotMatch(sent[0]?.content ?? "", /Briefly state the context/i);
});

test("shutdown cancels a queued continuation", async () => {
  const { handlers, sent } = setup([compaction()]);
  const onCompact = handlers.get("session_compact");
  const onShutdown = handlers.get("session_shutdown");
  assert.ok(onCompact);
  assert.ok(onShutdown);

  onCompact({ reason: "manual", willRetry: false });
  onShutdown({});
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(sent.length, 0);
});
