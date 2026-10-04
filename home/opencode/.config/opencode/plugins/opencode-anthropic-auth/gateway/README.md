# subs-claude gateway plugin

Content-only shaping for `subs-claude` (CLIProxyAPI Claude pool at
`https://subs.oox.sh`), OpenCode
port of Pi's `extensions/anthropic-auth` gateway mode. The gateway adds Claude
Code identity, billing, betas, user-agent, system relocation and tool aliases;
this plugin adds none of them.

Separate plugin entry (`./plugins/opencode-anthropic-auth/gateway`, listed first):
the direct-mode plugin (`../index.mjs`) currently fails to load on 2.0.20
(`ctx.catalog` no longer exists) and OpenCode only warns, so sharing its setup
would silently drop gateway shaping.

## Implementation

An OpenCode **Effect** plugin (`server.ts`; shared deps in `../../package.json`):
- `shaping.ts`: the pure transforms over parsed JSON, plus the `http.request` body as an
  Effect failing with `GatewayShapingError`. Shaping output is byte-identical to the previous
  `shaping.mjs` on every captured OpenCode 2.0.20 request (checked when migrating).
- `server.ts`: registers the hooks in the plugin scope (unload removes them). A shaping failure
  becomes a defect via `Effect.orDie`, so the host fails the request: the same semantics as the
  previous Promise plugin, whose thrown errors the host's Promise adapter also turned into
  defects. The sentinel URL stays as the second fail-closed layer.

## Behavior

- `http.request` hook, `providerID: subs-claude`, every kind (`primary`,
  `compaction`, `title`, `generate`):
  - rewrites OpenCode-authored prompt text (intro, `# Harness`, env preamble,
    `/tmp/opencode` env line, Code Mode namespace prose, built-in `opencode`/`report`
    skills); project context, user skills and tools stay
  - strips `[Assistant reasoning]:` segments from `<conversation-checkpoint>`
    `<recent-context>` (replayed in every later request) and from bare transcripts in
    compaction requests
  - splits invalid assistant text-after-tool ordering (Pi parity)
  - removes `x-opencode-*`, `traceparent`, `tracestate`, `b3` request headers
  - re-targets the sentinel URL to the gateway, only after shaping succeeded
- `context`/`compaction`/`generate`/`title` hooks drop reasoning parts without an
  Anthropic signature/redacted data (history from another provider), which OpenCode
  would otherwise lower to plain assistant text.

## Fail closed

`opencode.jsonc` points `subs-claude` at `http://127.0.0.1:9/subs-claude-unshaped/v1`
(nothing listens). Shaping errors throw and leave that URL, so the request fails.
Without the plugin requests fail with a transport error after OpenCode's retries
(~80 s, "socket connection was closed unexpectedly"): check the plugin loaded.
The default origin is `https://subs.oox.sh`. `OPENCODE_SUBS_CLAUDE_GATEWAY_ORIGIN`
overrides it for isolated tests; it must be a bare loopback origin or exactly
`https://subs.oox.sh` (exact-origin allowlist, no subdomains/ports/paths).

## Not removable here

- `b3`/`traceparent` are added by OpenCode's HTTP client after the hook.
- `user-agent: opencode/...`, `x-session-affinity`/`x-session-id` are left for the gateway.
- Code Mode `tools.opencode.*` paths and the plan-mode `~/.opencode/plan` path are
  functional and kept, as are user context (your `AGENTS.md` path, skills and
  tool descriptions that mention OpenCode).

CLIProxyAPI 7.3.20 builds a fresh upstream request from a header allowlist
(`internal/runtime/executor/claude_executor_request.go`), so `b3`, `traceparent`,
`tracestate`, `x-session-*` and `x-opencode-*` never reach Anthropic. With Claude
OAuth credentials it replaces the user-agent with its Claude Code profile and
cloaks non-Claude-Code clients (identity block, billing header, system relocation).
Recheck this when upgrading CLIProxyAPI.

## Live gate check (2026-10-03, OpenCode 2.0.20, CLIProxyAPI 7.3.20)

Isolated profile, gateway origin pointed at a local gate that refused any body
containing OpenCode prompt fingerprints, `[Assistant reasoning]` or
`[Assistant thinking]`. A Codex turn, a switch to `subs-claude` with tool use,
`#max` thinking, two compactions and post-compaction turns: all 9 `subs-claude`
requests passed the gate and got answers. Signed thinking was replayed natively,
Codex reasoning never appeared as text, and the remaining `opencode` mentions
were the functional and user-context ones listed above.

## Verify

```sh
npm test   # from home/opencode/.config/opencode
OPENCODE_TEST_BINARY=$(readlink -f "$(command -v opencode)") node --test plugins/opencode-anthropic-auth/gateway/upstream-drift.test.mjs
```

End-to-end checks use only the fake server in `fixtures/` (see its README); never
send test traffic to the real gateway.
