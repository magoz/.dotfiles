# Dashboard footer

Shows the selected model/thinking level, directory, context usage, Git/PR status,
and subscription allowance. Auto-discovered by Pi; use `/reload` after changes.

## Subscription usage

Restores the local usage tracker removed when multi-account failover was enabled.
No dependency on `pi-multi-account` remains.

- **Codex OAuth:** remaining allowance and resets from `https://chatgpt.com/backend-api/wham/usage`.
- **Anthropic OAuth:** aggregate 5-hour and 7-day allowance from `https://api.anthropic.com/api/oauth/usage`.
- **Grok / SuperGrok OAuth:** remaining included-pool allowance from
  `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` when the selected
  model is xAI OAuth on the official inference origin `https://api.x.ai/v1`.
  That billing URL is a first-party Grok Build CLI internal API, pinned to
  [`xai-org/grok-build@37949780c144e37df692e3d669051a21fec24f20`](https://github.com/xai-org/grok-build/blob/37949780c144e37df692e3d669051a21fec24f20/crates/codegen/xai-grok-shell/src/extensions/billing.rs)
  `crates/codegen/xai-grok-shell/src/extensions/billing.rs`, not a public product
  quota contract. Requests send only `Authorization: Bearer`,
  `X-XAI-Token-Auth: xai-grok-cli`, and `Accept: application/json`.
  Remaining percent is `100 - config.creditUsagePercent` when that field is a
  finite number; `config.currentPeriod.end` (RFC 3339) is the reset. Exact period
  types `USAGE_PERIOD_TYPE_WEEKLY` / `USAGE_PERIOD_TYPE_MONTHLY` render as `7d` /
  `month`; any other type uses a fixed `usage` label and is never copied from the
  server. Missing, null, or non-finite `creditUsagePercent` (including proto3
  omit-zero) is unknown — not 0% used. PAYG, prepaid, API spend, `productUsage`,
  and legacy monthly cents are ignored. Unsupported or missing quota still shows
  muted `Grok quota unavailable`. Inference token usage or API pricing is never
  presented as subscription allowance.
- **OpenCode Go API key:** rolling, weekly, and monthly allowance from
  `GET https://opencode.ai/zen/go/v1/usage` when the selected model is
  `opencode-go` on the official inference origin `https://opencode.ai`
  (for example `https://opencode.ai/zen/go/v1`). Unlike the OAuth providers
  above, Go authenticates with an API key, so the footer queries it in API-key
  mode and never in OAuth mode. Requests send only `Authorization: Bearer` and
  `Accept: application/json`. The payload is
  `{ usage: { rolling: { percent, resetsAt }, weekly: {...}, monthly: {...} } }`
  where `percent` is used percent; remaining is `100 - percent`. Windows render
  with fixed labels `5h` / `7d` / `month` (Go defines 5-hour as 20% of the
  monthly limit and weekly as 50%). `resetsAt` (RFC 3339) is the reset;
  `resets_in_seconds` / `resetInSec` relative fallbacks are also accepted.
  Missing or non-finite `percent` is unknown, never 0% used.
- Other providers, mismatched auth modes, and custom/proxy origins are not queried.
- **Z.ai (GLM Coding Plan) API key:** 5-hour and weekly token allowance from
  `GET https://api.z.ai/api/monitor/usage/quota/limit` when the selected model is
  `zai` on the official inference origin `https://api.z.ai`
  (for example `https://api.z.ai/api/coding/paas/v4`). Like Go, Z.ai
  authenticates with an API key, so the footer queries it in API-key mode and
  never in OAuth mode. Requests send only `Authorization: Bearer` and
  `Accept: application/json`. The payload is
  `{ data: { limits: [{ type, unit, percentage, nextResetTime }] } }` where
  `percentage` is used percent; remaining is `100 - percentage`. Allowance
  windows render with fixed labels `5h` (`CREDIT_LIMIT`/`TOKENS_LIMIT` `unit` 3)
  and `7d` (`unit` 6); live Max-plan keys report `CREDIT_LIMIT`, older/token
  plans reported `TOKENS_LIMIT`, and both are accepted. `nextResetTime` (epoch
  milliseconds) is the reset. Monthly `TIME_LIMIT` web-search quota is ignored.
  Missing or non-finite `percentage` is unknown, never 0% used.

Example: `5h 63% left / 2h 14m · 7d 8% left / 4d 3h`.
Each remaining percentage uses the active theme: `muted` above 30%, `warning`
at 30% or below, `error` at 10% or below. Countdown labels and separators stay muted.
Missing reset metadata says `reset unknown`; elapsed resets say `reset pending`
until refreshed, never an invented 100%. Failed refreshes retain muted, labeled
`(stale)` readings rather than pretending they are live.

HTTP refresh is throttled per provider (5 minutes Codex, Grok, and Go, 10 minutes Anthropic);
countdowns repaint every minute without extra HTTP requests. HTTP 429
`Retry-After` can extend the interval. Requests have a 15-second deadline and do
not block startup. Provider changes and shutdown cancel pending work; late
responses cannot update another provider/session's footer.

Authentication is resolved by Pi's model registry. Requests use fixed official
HTTPS endpoints, allowlisted auth headers, and reject redirects. The tracker
never reads credential files, stores credentials, writes shared state, selects
models, changes thinking levels, registers providers, retries inference, or
continues tasks. Cached telemetry is process/session-local and is discarded on
shutdown/reload. Signing into a different account of the same provider may require
`/reload` to discard its cached reading immediately.

## Verify

```sh
npm --prefix home/pi/.pi run check --workspace=dashboard-footer
npm --prefix home/pi/.pi/agent/extensions/dashboard-footer test
```

Tests use synthetic credentials and mocked HTTP, covering parsing, colors,
unknown/stale data, throttling, cancellation, provider switches, narrow terminals,
and the registered footer lifecycle. They make no provider requests.
