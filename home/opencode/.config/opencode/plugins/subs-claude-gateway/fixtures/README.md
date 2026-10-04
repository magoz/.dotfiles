# Gateway fixtures

`opencode-2.0.20.json`: real OpenCode 2.0.20 Anthropic Messages bodies (no plugin)
for `subs-claude`: `title`, `primary` (signed thinking, plan reminder), first
`compaction`, `postCompaction` (checkpoint with `[Assistant reasoning]:`) and
`compactionReduced` (oversized-compaction fallback: bare transcript). `shared`
holds the common `system`/`tools`; `headers` lists request header names only.
`upstream-drift.test.mjs` asserts every anchor is still present and the shaped
bodies carry no fingerprints.

## Refresh (after an OpenCode upgrade)

Never point at the real gateway or Anthropic. Capture in an isolated network
namespace so nothing can leave loopback:

1. `unshare -rn` a holder process, `ip link set lo up`, enter it with
   `nsenter -t <pid> -U -n --preserve-credentials`.
2. Inside: `node fake-anthropic-server.mjs` (`FAKE_OUT=<dir>`; port 18555).
3. Temp `HOME`/`XDG_*` dirs, `env -i`, config with a `subs-claude` provider
   (`baseURL` `http://127.0.0.1:18555/v1`, dummy `settings.apiKey`), no plugin.
   Drive with `opencode run --standalone` (prompt `USE_TOOL ...` makes the fake
   reply with thinking + tool_use), `--agent plan`, then
   `opencode api --standalone POST /api/session/<id>/compact -d '{}'` twice
   (touch `FAKE_413_FLAG` before the second for the reduced transcript).
4. Rebuild the JSON with the same keys; run `npm test` and, optionally,
   `OPENCODE_TEST_BINARY=$(readlink -f "$(command -v opencode)") node --test upstream-drift.test.mjs`.
