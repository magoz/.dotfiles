# Anthropic auth

Local Pi extension for Claude Pro/Max OAuth compatibility, directly (`anthropic`) or through the `subs-claude` gateway.

## Behavior

- preserves Pi's built-in `anthropic` models, API-key path, `/login`, and token refresh
- `anthropic`: activates request shaping only for `sk-ant-oat` OAuth credentials; API-key requests are untouched
- gateway providers (`ANTHROPIC_GATEWAY_PROVIDERS` in `index.ts`, currently `subs-claude`): always apply content fixes only (see below), gated by provider, not token
- `anthropic` OAuth only: injects Claude Code billing metadata and keeps billing and HTTP user-agent versions aligned
- both modes: removes Pi-specific prompt fingerprints while preserving tools/project context
- repairs invalid assistant text/tool ordering
- strips transcribed `[Assistant thinking]` segments from Pi-generated compaction, turn-prefix, and branch-summary requests before computing billing metadata; ordinary chat and native thinking blocks are unchanged
- `anthropic`: delegates auth headers, beta flags, Claude identity, and tool-name casing to Pi; `subs-claude`: delegates all of that plus billing to the gateway

Pi auto-discovers this directory. Run `/login anthropic`, then choose an Anthropic model. Run `/reload` after local updates. Set `ANTHROPIC_CLI_VERSION` to override the billing and user-agent version (default `2.1.280`, verified against the current npm release).

## `subs-claude` gateway mode

`subs-claude` routes Claude through a local CLIProxyAPI gateway holding pooled Claude OAuth accounts. Pi authenticates with a plain gateway key, so token-based detection never fires; the extension registers a stream-only overlay (`api` + `streamSimple`, no models/baseUrl/apiKey). Models, `baseUrl`, and auth still come from `models.json`/`auth.json`, so `subs-claude` must be defined in `models.json` or the overlay has no models to apply to.

| Plugin (content) | Gateway (transport/identity) |
| --- | --- |
| Pi prompt sanitization | Claude Code 2.1.280 headers/user-agent |
| summarization `[Assistant thinking]` stripping | signed billing header (drops caller `x-anthropic-billing-header:` blocks) |
| assistant text/tool ordering split | identity system block, `metadata.user_id`, session ids, betas |
| | system-prompt relocation, MCP tool aliases, `fallbacks`, date reminders |

The plugin adds no billing block, user-agent, identity block, or headers here. It fills gateway content gaps: raw Pi prompt fingerprints, transcribed thinking in summarization requests (blocks `/compact` as a ToS "duplicating model outputs" violation, gotgenes/pi-anthropic-auth#65), and invalid assistant ordering.

Requires CLIProxyAPI ≥ 7.3.15: Anthropic gates Opus 5.5 on Claude Code ≥ 2.1.280, and older gateways impersonate 2.1.258 and get "does not support this model".

Gateway-side differences you will notice:

- server-side `fallbacks: [{"model": "claude-opus-4-8"}]` on Opus 5.5 requests: if Opus 5.5 is unavailable, Anthropic may answer with Opus 4.8
- a currentDate `<system-reminder>` injected into the first user message
- upstream tool names disguised as `mcp__<random>__<random>_<tool>` aliases
- 1h cache TTL on the injected identity block

## Scope

Shaping covers requests routed through Pi's registered providers. Direct `pi-ai` compatibility API calls from extensions/background agents bypass it; this extension does not override the shared API registry.

## Verify

```sh
npm test
# From the repository root:
npm --prefix home/pi/.pi run check --workspace=pi-anthropic-auth-local
ANTHROPIC_OAUTH_TOKEN=sk-ant-oat-smoke-test pi --offline --no-extensions -e ./home/pi/.pi/agent/extensions/anthropic-auth/index.ts --list-models anthropic
# Overlay must keep the models.json models (e.g. claude-opus-5-5):
pi --offline --no-extensions -e ./home/pi/.pi/agent/extensions/anthropic-auth/index.ts --list-models subs-claude
```

Live wire check (2026-09-28, CLIProxyAPI 7.3.20, Pi 0.87.1): with a local gate between Pi and the gateway that blocks any summary request containing `[Assistant thinking]`, an RPC session on `subs-claude/claude-opus-5-5` (thinking high, tool use, `keepRecentTokens: 50`, then `compact`) sent no Pi prompt fingerprints and compacted successfully through Anthropic with zero transcribed-thinking markers in both summary requests. The same run with `--no-extensions` leaked the Pi prompt on every turn and had its summary request blocked (2 markers). Repeat this with a gate rather than live traffic: a leaked summary is a ToS block on the account.

`gateway.test.ts` covers gateway mode and `anthropic` regressions; `index.test.ts` covers registration. The overlay relies on Pi's provider composer (`dist/core/provider-composer.js`, verified in installed CLI `0.87.1`) using an extension's `streamSimple` when `model.api` matches its `api`.

## Provenance

- local OpenCode implementation: `home/opencode/.config/opencode/plugins/opencode-anthropic-auth/index.mjs`
- Pi architecture/reference: `gotgenes/pi-anthropic-auth` commit `22883511d16d3fe381b140fb1de10b428c2c8a89`
- summarization fix ported from `gotgenes/pi-anthropic-auth` `v2.0.9` (`d2fdab837549e500ec30e634ab87e61b7c2f3881`); local prompt-preservation fallback already matches the newer approach
- Pi workspace SDK: `@earendil-works/pi-coding-agent` `0.85.1`; also verified against installed CLI `0.87.1`

`upstream-drift.test.ts` verifies the summarization anchor and transcript markers against the workspace SDK. Set `PI_TEST_CODING_AGENT_ENTRYPOINT` to a `file://` URL for another installation's `dist/index.js` to check that host too. It deliberately reads Pi internals only in tests, never at extension startup.

See `THIRD_PARTY_NOTICES.md`.
