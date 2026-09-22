# Anthropic auth

Local Pi extension for Claude Pro/Max OAuth compatibility.

## Behavior

- preserves Pi's built-in `anthropic` models, API-key path, `/login`, and token refresh
- activates request shaping only for `sk-ant-oat` OAuth credentials
- injects Claude Code billing metadata
- keeps billing and HTTP user-agent Claude Code versions aligned
- removes Pi-specific prompt fingerprints while preserving tools/project context
- repairs invalid assistant text/tool ordering
- strips transcribed `[Assistant thinking]` segments from Pi-generated compaction, turn-prefix, and branch-summary requests before computing billing metadata; ordinary chat and native thinking blocks are unchanged
- delegates auth headers, beta flags, Claude identity, and tool-name casing to Pi

Pi auto-discovers this directory. Run `/login anthropic`, then choose an Anthropic model. Run `/reload` after local updates. Set `ANTHROPIC_CLI_VERSION` to override the billing and user-agent version (default `2.1.280`, verified against the current npm release).

Shaping covers requests routed through Pi's registered provider. Direct `pi-ai` compatibility API calls from extensions/background agents bypass it; this extension does not override the shared API registry.

## Verify

```sh
npm test
# From the repository root:
npm --prefix home/pi/.pi run check --workspace=pi-anthropic-auth-local
ANTHROPIC_OAUTH_TOKEN=sk-ant-oat-smoke-test pi --offline --no-extensions -e ./home/pi/.pi/agent/extensions/anthropic-auth/index.ts --list-models anthropic
```

## Provenance

- local OpenCode implementation: `home/opencode/.config/opencode/plugins/opencode-anthropic-auth/index.mjs`
- Pi architecture/reference: `gotgenes/pi-anthropic-auth` commit `22883511d16d3fe381b140fb1de10b428c2c8a89`
- summarization fix ported from `gotgenes/pi-anthropic-auth` `v2.0.9` (`d2fdab837549e500ec30e634ab87e61b7c2f3881`); local prompt-preservation fallback already matches the newer approach
- Pi workspace SDK: `@earendil-works/pi-coding-agent` `0.82.1`; also verified against installed CLI `0.85.0`

`upstream-drift.test.ts` verifies the summarization anchor and transcript markers against the workspace SDK. Set `PI_TEST_CODING_AGENT_ENTRYPOINT` to a `file://` URL for another installation's `dist/index.js` to check that host too. It deliberately reads Pi internals only in tests, never at extension startup.

See `THIRD_PARTY_NOTICES.md`.
