# Anthropic auth

Local Pi extension for Claude Pro/Max OAuth compatibility.

## Behavior

- preserves Pi's built-in `anthropic` models, API-key path, `/login`, and token refresh
- activates request shaping only for `sk-ant-oat` OAuth credentials
- injects Claude Code billing metadata
- keeps billing and HTTP user-agent Claude Code versions aligned
- removes Pi-specific prompt fingerprints while preserving tools/project context
- repairs invalid assistant text/tool ordering
- delegates auth headers, beta flags, Claude identity, and tool-name casing to Pi

Pi auto-discovers this directory. Run `/login anthropic`, then choose an Anthropic model. Set `ANTHROPIC_CLI_VERSION` to override the billing version.

## Verify

```sh
npm test
ANTHROPIC_OAUTH_TOKEN=sk-ant-oat-smoke-test pi --list-models anthropic
```

## Provenance

- local OpenCode implementation: `opencode/.config/opencode/plugins/opencode-anthropic-auth/index.mjs`
- Pi architecture/reference: `gotgenes/pi-anthropic-auth` commit `22883511d16d3fe381b140fb1de10b428c2c8a89`
- Pi API target: `@earendil-works/pi-coding-agent` `0.82.1`

See `THIRD_PARTY_NOTICES.md`.
