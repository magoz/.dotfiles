# Gateway fixtures

`opencode-2.2.6.json`: real OpenCode 2.2.6 Anthropic Messages bodies (no plugin)
for `subs-claude`: `title`, `primary` (native signed thinking, plan reminder), first
`compaction`, `postCompaction` (checkpoint, "no longer in Plan mode" reminder) and
`compactionReduced` (oversized-compaction fallback: bare transcript). `shared` holds the
common `system`/`tools`; `omitted` lists shared keys a request was sent without (2.2.6's
`compactionReduced` has no `tools`); `headers` lists request header names only.
`upstream-drift.test.mjs` asserts every anchor is still present and the shaped bodies
carry no fingerprints.

Since 2.2.6, checkpoints no longer transcribe signed thinking as `[Assistant reasoning]: `,
so the captures lack that anchor. The binary still embeds it; the drift test checks it
there, and `shaping.test.mjs` covers stripping it.

## Refresh (after an OpenCode upgrade)

Never point at the real gateway or Anthropic. `capture.sh` does the whole capture in a
fresh user + network namespace (`unshare -rn`, loopback only), with temp `HOME`/`XDG_*`,
`env -i`, a `subs-claude` provider pointed at `fake-anthropic-server.mjs` (port 18555) and
no plugin:

```sh
fixtures/capture.sh /path/to/new/opencode   # writes fixtures/opencode-<version>.json
```

It drives one isolated service (`opencode run --session`): a tool turn (the fake replies
with thinking + tool_use to `USE_TOOL ...`), a plain turn, a `--agent plan` turn, a
compaction, a post-compaction build turn, then a compaction answered with 413 (reduced
transcript retry). Compaction is asynchronous since 2.0.21, so it waits on
`/api/experimental/session/:id/wait`. Then delete the old fixture, point
`upstream-drift.test.mjs` at the new one, and run `npm test` and
`OPENCODE_TEST_BINARY=/path/to/new/opencode node --test upstream-drift.test.mjs`.
