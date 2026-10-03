// Fake Anthropic Messages + OpenAI Responses server used to capture fixtures.
// Records every request body; never forwards anything. Not run by tests.
import { createServer } from "node:http";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";

const port = Number(process.env.FAKE_PORT || 18555);
const outDir = process.env.FAKE_OUT || "/tmp/ocgw-captures";
mkdirSync(outDir, { recursive: true });
let seq = 0;

const text = (v) => (typeof v === "string" ? v : Array.isArray(v) ? v.map((b) => b?.text ?? "").join("\n") : "");

function classify(body) {
  const sys = text(body.system);
  if (sys.startsWith("You are a title generator")) return "title";
  const msgs = body.messages ?? [];
  const tail = JSON.stringify(msgs.slice(-2));
  if (tail.includes("You MUST summarize the conversation") || tail.includes("required summary template") || tail.includes("Update the existing checkpoint")) return "compaction";
  if (tail.includes("older exchange")) return "compaction";
  if (/summar/i.test(sys) && !body.tools?.length) return "compaction";
  return "primary";
}

function lastMessage(body) {
  const m = body.messages ?? [];
  return m[m.length - 1];
}

function plan(body, kind) {
  if (kind === "title") return [{ type: "text", text: "Fake session title" }];
  if (kind === "compaction") return [{ type: "text", text: "## Objective\n- Read hello.txt\n\n## Requirements\n- (none)\n\n## Decisions\n- (none)\n\n## Work State\n### Completed\n- Read hello.txt (says hi)\n\n### Active\n- (none)\n\n### Blocked\n- (none)\n\n## Next Move\n1. (none)\n\n## Relevant Files\n- `hello.txt`: target\n\n## Important Context\n- (none)" }];
  const last = lastMessage(body);
  const hasToolResult = Array.isArray(last?.content) && last.content.some((b) => b?.type === "tool_result");
  if (hasToolResult) return [
    { type: "thinking", thinking: "SECRET_THOUGHT_2 the file says hi.", signature: "sig-two" },
    { type: "text", text: "The file says hi. All done." },
  ];
  const lastText = text(last?.content) + JSON.stringify(last?.content ?? "");
  if (lastText.includes("USE_TOOL")) {
    const tool = (body.tools ?? []).find((t) => t.name === "read") ?? (body.tools ?? [])[0];
    const props = tool?.input_schema?.properties ?? {};
    const pathKey = ["filePath", "path", "file_path"].find((k) => k in props) ?? Object.keys(props)[0] ?? "path";
    return [
      { type: "thinking", thinking: "SECRET_THOUGHT_1 I should read the file.", signature: "sig-one" },
      { type: "text", text: "Let me read the file." },
      { type: "tool_use", id: `toolu_fake_${seq}`, name: tool?.name ?? "read", input: { [pathKey]: process.env.FAKE_FILE || "hello.txt" } },
    ];
  }
  return [
    { type: "thinking", thinking: "SECRET_THOUGHT_0 plain reply.", signature: "sig-zero" },
    { type: "text", text: "Hello from fake Claude." },
  ];
}


function openaiResponses(req, res, body, n) {
  const input = body.input ?? [];
  const last = input[input.length - 1];
  const hasToolOutput = last?.type === "function_call_output";
  const tools = body.tools ?? [];
  const tool = tools.find((t) => t.name === "read") ?? tools[0];
  let seqNo = 0;
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seqNo++, ...data })}\n\n`);
  const id = `resp_fake_${n}`;
  const base = { id, object: "response", created_at: 1, model: body.model, status: "in_progress", output: [] };
  res.writeHead(200, { "content-type": "text/event-stream" });
  ev("response.created", { response: base });
  const output = [];
  let idx = 0;
  // reasoning item with summary
  const rsId = `rs_fake_${n}`;
  const summary = hasToolOutput ? "GPT_SECRET_THOUGHT_B reading done." : "GPT_SECRET_THOUGHT_A I should read the file.";
  ev("response.output_item.added", { output_index: idx, item: { type: "reasoning", id: rsId, summary: [] } });
  ev("response.reasoning_summary_part.added", { item_id: rsId, output_index: idx, summary_index: 0, part: { type: "summary_text", text: "" } });
  ev("response.reasoning_summary_text.delta", { item_id: rsId, output_index: idx, summary_index: 0, delta: summary });
  ev("response.reasoning_summary_text.done", { item_id: rsId, output_index: idx, summary_index: 0, text: summary });
  ev("response.reasoning_summary_part.done", { item_id: rsId, output_index: idx, summary_index: 0, part: { type: "summary_text", text: summary } });
  const rsItem = { type: "reasoning", id: rsId, summary: [{ type: "summary_text", text: summary }], encrypted_content: "gAAAA-fake-encrypted" };
  ev("response.output_item.done", { output_index: idx, item: rsItem });
  output.push(rsItem); idx++;
  // message
  const msgId = `msg_fake_${n}`;
  const text = hasToolOutput ? "GPT says the file says hi." : "GPT will read the file.";
  ev("response.output_item.added", { output_index: idx, item: { type: "message", id: msgId, status: "in_progress", role: "assistant", content: [] } });
  ev("response.content_part.added", { item_id: msgId, output_index: idx, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
  ev("response.output_text.delta", { item_id: msgId, output_index: idx, content_index: 0, delta: text });
  ev("response.output_text.done", { item_id: msgId, output_index: idx, content_index: 0, text });
  ev("response.content_part.done", { item_id: msgId, output_index: idx, content_index: 0, part: { type: "output_text", text, annotations: [] } });
  const msgItem = { type: "message", id: msgId, status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] };
  ev("response.output_item.done", { output_index: idx, item: msgItem });
  output.push(msgItem); idx++;
  if (!hasToolOutput && tool) {
    const fcId = `fc_fake_${n}`;
    const args = JSON.stringify({ path: process.env.FAKE_FILE || "hello.txt" });
    ev("response.output_item.added", { output_index: idx, item: { type: "function_call", id: fcId, call_id: `call_fake_${n}`, name: tool.name, arguments: "", status: "in_progress" } });
    ev("response.function_call_arguments.delta", { item_id: fcId, output_index: idx, delta: args });
    ev("response.function_call_arguments.done", { item_id: fcId, output_index: idx, arguments: args });
    const fcItem = { type: "function_call", id: fcId, call_id: `call_fake_${n}`, name: tool.name, arguments: args, status: "completed" };
    ev("response.output_item.done", { output_index: idx, item: fcItem });
    output.push(fcItem); idx++;
  }
  ev("response.completed", { response: { ...base, status: "completed", output, usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 5 }, total_tokens: 120 } } });
  res.end();
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const n = ++seq;
    const raw = Buffer.concat(chunks).toString("utf8");
    let body;
    try { body = JSON.parse(raw); } catch { body = undefined; }
    const kind = !body ? "unparsed" : req.url.includes("/responses") ? "openai" : classify(body);
    const headers = { ...req.headers };
    for (const k of ["x-api-key", "authorization"]) if (headers[k]) headers[k] = `<redacted len=${headers[k].length}>`;
    writeFileSync(`${outDir}/${String(n).padStart(3, "0")}-${kind}.json`, JSON.stringify({ method: req.method, url: req.url, headers, kind, body: body ?? raw }, null, 2));
    if (body && req.method === "POST" && req.url.includes("/responses")) { openaiResponses(req, res, body, n); return; }
    if (!body || req.method !== "POST" || !req.url.includes("/messages")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: `fake: ${req.method} ${req.url}` } }));
      return;
    }
    if (kind === "compaction" && existsSync(process.env.FAKE_413_FLAG || "/tmp/ocgw-fake-413")) {
      unlinkSync(process.env.FAKE_413_FLAG || "/tmp/ocgw-fake-413");
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "fake oversized payload" } }));
      return;
    }
    const blocks = plan(body, kind);
    const stop = blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
    const id = `msg_fake_${n}`;
    const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, type: "message", role: "assistant", model: body.model, content: blocks, stop_reason: stop, stop_sequence: null, usage }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    sse(res, "message_start", { message: { id, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
    blocks.forEach((b, index) => {
      if (b.type === "thinking") {
        sse(res, "content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
        sse(res, "content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } });
        sse(res, "content_block_delta", { index, delta: { type: "signature_delta", signature: b.signature } });
      } else if (b.type === "text") {
        sse(res, "content_block_start", { index, content_block: { type: "text", text: "" } });
        sse(res, "content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
      } else if (b.type === "tool_use") {
        sse(res, "content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
        sse(res, "content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
      }
      sse(res, "content_block_stop", { index });
    });
    sse(res, "message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } });
    sse(res, "message_stop", {});
    res.end();
  });
});
server.listen(port, "127.0.0.1", () => console.log(`fake anthropic on ${port} -> ${outDir}`));
