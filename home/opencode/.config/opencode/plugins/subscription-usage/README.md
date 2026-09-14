# Subscription usage (OpenCode assessment)

`/subscription-usage` or `/quota` displays Codex, Claude, or Grok OAuth allowance.
This is intentionally an on-demand cached snapshot, not a replacement footer.
No startup requests, inference, auth-file reads, account switching, or Pi imports.
Credentials stay in the server and resolve via the native integration connection.
The TUI receives only normalized percentages/reset text. API keys and unsupported
origins are skipped. Fixed HTTPS endpoints reject redirects and have a 15s timeout;
5m cache (10m Claude), 429 backoff, cancellation on plugin unload.

Payload conventions follow the local Pi footer's provider implementations, but
this adapter is independent so Pi can evolve during assessment. Grok uses its
first-party internal CLI billing endpoint, not a public stable quota contract;
missing `creditUsagePercent` means unknown. Recheck compatibility when providers
change. Missing auth/model data reports unavailable, never 100% allowance.

Assessment limitation: this has synthetic tests, not live quota-provider checks.

Cache/security boundaries:

- Every call verifies session location, model/provider origin and the current
  OAuth connection before considering cached data. Cache identity includes
  provider, credential connection ID and verified account ID; malformed supplied
  account IDs are refused. Failed auth/identity checks never return stale data.
- Fetch/network/15s timeout, HTTP, body/UTF-8/JSON parse, oversize and unknown-payload
  failures consistently return the same verified identity's last successful sample
  as `stale`. Retry is cached for the normal 5m/10m TTL; 429 may extend backoff to at
  most one day. Stale retention is **strictly less than 24h from the last success**,
  including during backoff; failures never renew it. Then output is unavailable.
- Native RPC `context.signal` reaches get/fetch/body consumption. Caller abort,
  superseded same-session requests and unload return unavailable, never stale,
  and do not install a failure backoff. Disposal clears cache and aborts all work.
  Overlapping sessions may fetch independently; only the current identity-cache
  entry may publish, so older completions cannot overwrite newer results.
- Response bodies are bounded to **64 KiB of bytes while streaming**, including
  multibyte UTF-8. Oversize/abort cancels the reader; non-OK/late-aborted response
  bodies are also canceled. Fixed URLs, redirect rejection and server-only tokens
  remain unchanged. No raw provider body/error reaches the TUI.
- TUI requests cancel older requests and unload; late results/errors after route
  changes are suppressed. A route change alone does not proactively abort a
  request (native RPC timeout still applies). Malformed/RPC errors show only a
  fixed warning, not upstream text.

Offline tests cover controlled-clock stale expiry/retry/retention, auth/account
isolation, stream bounds, timeout/abort/overlap/unload and server/TUI boundaries.
These are synthetic contracts, not live quota-provider or full interactive checks.
