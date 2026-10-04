import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { OPENCODE_ANCHORS, shapeGatewayPayload } from "./shaping.ts";

// Pinned OpenCode 2.0.20 captures (see fixtures/README.md for refreshing).
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/opencode-2.0.20.json", import.meta.url), "utf8"),
);
const requests = {
  title: { kind: "title", body: fixture.title },
  primary: { kind: "primary", body: { ...fixture.shared, ...fixture.primary } },
  compaction: { kind: "compaction", body: { ...fixture.shared, ...fixture.compaction } },
  postCompaction: { kind: "primary", body: { ...fixture.shared, ...fixture.postCompaction } },
  compactionReduced: { kind: "compaction", body: { ...fixture.shared, ...fixture.compactionReduced } },
};
const FINGERPRINTS = [
  /You are an AI agent running in OpenCode/,
  /coding agent harness/,
  /\n# Harness\n/,
  /harness instructions/,
  /Here is some useful information about the environment/,
  /Prefer \S*opencode\S* over generic/,
  /Tools for managing OpenCode itself/,
  /<id>opencode<\/id>/,
  /report an opencode issue/,
  /\[Assistant reasoning\]: /,
];
// Remaining "opencode" substrings that are functional, not prose: Code Mode
// call paths/namespace and the plan-mode file directory.
const ALLOWED_OPENCODE = /tools\.opencode\.|- opencode \(\d+ tools\)|\/\.opencode\/plan/g;

function textOf(body) {
  // Native thinking blocks are model output replayed as-is; exclude them.
  return JSON.stringify({
    ...body,
    messages: body.messages.map((message) =>
      Array.isArray(message.content)
        ? { ...message, content: message.content.filter((block) => block.type !== "thinking") }
        : message,
    ),
  });
}

test("fixture still contains every anchor the shaping depends on", () => {
  const all = Object.values(requests).map(({ body }) => JSON.stringify(body)).join("\n");
  for (const anchor of OPENCODE_ANCHORS) {
    assert.ok(all.includes(JSON.stringify(anchor).slice(1, -1)), `missing anchor: ${anchor}`);
  }
  // Transcribed reasoning is present before shaping, so the checks below bite.
  assert.match(JSON.stringify(requests.postCompaction.body), /\[Assistant reasoning\]: /);
  assert.match(JSON.stringify(requests.compactionReduced.body), /\[Assistant reasoning\]: /);
  assert.ok(fixture.headers.some((name) => name.startsWith("x-opencode-")));
});

test("shaped captures carry no fingerprints or transcribed reasoning", () => {
  for (const [name, { kind, body }] of Object.entries(requests)) {
    const shaped = shapeGatewayPayload(body, { kind });
    const text = textOf(shaped);
    for (const fingerprint of FINGERPRINTS) {
      assert.doesNotMatch(text, fingerprint, `${name}: ${fingerprint}`);
    }
    const leftover = text.replace(ALLOWED_OPENCODE, "").match(/opencode/gi) ?? [];
    assert.deepEqual(leftover, [], `${name}: unexpected opencode mentions`);
    // Tools, project context, and native thinking survive.
    assert.equal(shaped.tools?.length ?? 0, body.tools?.length ?? 0);
    if (body.system && name !== "title") assert.match(JSON.stringify(shaped.system), /PROJECT_CONTEXT_MARKER/);
    assert.deepEqual(shapeGatewayPayload(shaped, { kind }), shaped, `${name}: idempotent`);
  }
  const nativeThinking = (body) =>
    body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "thinking");
  assert.deepEqual(
    nativeThinking(shapeGatewayPayload(requests.primary.body)),
    nativeThinking(requests.primary.body),
  );
});

// Opt-in: OPENCODE_TEST_BINARY=$(readlink -f "$(command -v opencode)") checks the
// installed build's embedded prompt strings without running it.
test("installed OpenCode binary still embeds the anchors", { skip: !process.env.OPENCODE_TEST_BINARY }, () => {
  const binary = readFileSync(process.env.OPENCODE_TEST_BINARY ?? "");
  for (const anchor of [...OPENCODE_ANCHORS, "<recent-context>", "over generic system temporary directories"]) {
    assert.ok(binary.includes(anchor), `binary missing anchor: ${anchor}`);
  }
});
