# until

Background shell-condition watches and recurring agent wakes for OpenCode, owned by one
session. A port of Pi's [pi-until](https://github.com/joelhooks/pi-until) (`e2eceb0`) with the
same tool contract, so agents use it the same way in both harnesses.

The agent arms a watch and ends its turn. The server polls; the session is woken with a receipt.

```text
until({ action: "start", condition: "gh run view 123 --json status -q .status | grep -qx completed", label: "CI run 123" })
```

## Agent tool

One direct tool, `until`, with pi-until's six actions and parameter names:

| Action | Does |
| --- | --- |
| `start` | Run `condition` now, then every `intervalSeconds` (30). Wakes on true, on `timeoutSeconds`, or on failure. |
| `repeat` | Wake every `intervalSeconds` with a fixed `instruction` + `quickRef` until `timeoutSeconds` (required). Optional `condition` gates each tick. |
| `list` / `status` | Receipts for this session (status includes the condition and cwd). |
| `complete` | End a recurring watch as achieved. |
| `cancel` | Stop a watch without success; nobody is woken. |

Other `start` parameters: `label`, `cwd` (relative or `~`, from the session directory),
`checkTimeoutSeconds` (30), `wake: agent | notify`. `repeat` adds `contextRefs` and `immediate`.
The description carries pi-until's guidance (fail-closed conditions, no same-batch arming,
verify a wake before acting, list before re-arming), so it reaches every model unprompted.

What makes it pleasant for agents:

- **No confirmation.** Gated only by the agent's `shell` permission (`options.permission`):
  wherever shell is denied, the tool is hidden.
- **Inline answer.** `start` waits up to 3s for the first check. Already true: the call returns
  `Condition is already true… continue now` and no watch or wake exists. Otherwise it returns the
  watch ID, cadence and first exit code, plus "end your turn; do not poll".
- **Every outcome wakes.** Success, timeout and spawn failure each queue one synthetic message
  (`delivery: queue`, `resume: true`) with the receipt and what to do next. The transcript shows
  `until · <label> · condition met after 3 checks (1m30s)`.
- **Slow checks are not fatal.** A check past `checkTimeoutSeconds` is terminated with its
  process group and counts as false; polling continues.
- **Errors say what to fix**: `cwd is not a directory: …`, `Unknown until watch in this
  session: x. Run until action=list…`, `action=list does not accept id`.
- **Subagents can arm watches; the main session is woken.** OpenCode reports a subagent's result
  to its parent once, so waking the finished subagent would do unseen work. A subagent's watch
  belongs to the family root instead: the root is woken, the receipt says `Armed by: subagent
  session …`, and the subagent is told to put the watch ID in its result and finish. The
  condition still runs in the subagent's directory. Any session in the family can list/cancel.

## Lifecycle

- Esc does not stop watches (pi parity). Session deletion forgets them; `cancel` stops them.
- Every change is written to plugin storage (`ctx.storage`, `watch/<session>/<id>`). Plugin
  reloads and server restarts restore this location's running watches (`reloads` counts them).
  Watches whose deadline passed while nothing owned them finish silently, like pi-until.
  Plugins run per location, so after a server restart a location's watches resume when
  OpenCode next loads that location (opening any of its sessions does).
- Wakes carry a persisted `msg_` ID and are retried (0, 1s, 5s, 30s) with that same ID, so a
  retry or a post-restart resend is admitted at most once. An exhausted wake is kept and marked
  `wake failed` in receipts.
- Recurring wakes are serialized per watch: the next tick waits until OpenCode delivers the
  wake (`session.inbox.delivered`) and the run ends (`session.execution.*`, or `session.wait`
  as backstop). Ticks that pass meanwhile become `missedTicks`; cadence stays anchored.
- Limits: 32 running watches and 50 finished receipts per session.

## TUI

- A dock above the composer (OpenCode's queued-prompt style) while the family's watches run:
  `◷ CI run 123 · next 12s · 2m14s · 5 checks`, at most three rows; click opens the list.
- `/until <condition>` (prompts when empty), `/until-list` (picker → status/complete/cancel),
  `/until-cancel [id]`, `/until-complete [id]` (pick when empty), `/until-stats`.
- `wake: notify` results toast in-app and send a desktop notification when the terminal is blurred.

Conditions, cwd and task text never cross the TUI RPC (views carry labels and counts only;
`status` shows the receipt on request).

## Telemetry

One JSON line per event in `$XDG_STATE_HOME/opencode/until/events.jsonl` (`started`,
`finished`, `resumed`, `action`). Conditions are a 12-character hash; instructions never.
Labels are written, so keep them safe.
`OPENCODE_UNTIL_TELEMETRY=0` disables it; `OPENCODE_UNTIL_TELEMETRY_FILE` moves it.

## Safety

Conditions run through `$SHELL -c` with the server's environment minus `HERDR_*` (the server's
pane is never the user's). Output is discarded at the OS level. This is arbitrary shell access,
like the `shell` tool, and not a sandbox: conditions must be side-effect free by contract.

## Not ported

- pi-until's `pi-until:follow-up` queue sharing for other extensions (no OpenCode consumer).
- A session-wide arbiter across watches: OpenCode's inbox already queues synthetic wakes behind
  the running turn and holds them through compaction.
- `/until-resume`: restoration is automatic from durable storage.

## Implementation

The server is an OpenCode V2 **Effect** plugin in TypeScript (`server.ts` exports
`{ id, effect }`); OpenCode loads `.ts` directly, no build. The TUI (`tui.js`, `view.js`) stays
plain JS on the host's Solid runtime.

- **One fiber per watch** in a plugin-scoped `FiberMap`. A watch is `raceFirst(loop, deadline)`;
  checks, sleeps and wake retries are interruptible Effects. Unloading the plugin interrupts the
  fibers without finishing the watches; the next generation restores them from storage.
- **Checks** (`check.ts`) are an Effect over a detached process group: `timeoutOption` makes a
  slow check `killed` (= false), and interruption SIGTERMs then SIGKILLs the whole group.
- **Recurring serialization** waits on a `Deferred` per in-flight wake, completed by
  `session.inbox.delivered` + `session.execution.*` events (or `session.wait` as backstop).
- **Parse at the boundary:** tool input, stored records (`Schema.fromJsonString(StoredWatch)`),
  telemetry lines and session events are decoded with Effect Schema; malformed records are
  dropped, never half-run.
- **Tests** use `TestClock`, so cadence, deadlines and retries run instantly and deterministically.

### Effect version and `portable()`

The local Effect plugins share `plugins/package.json`: their own `effect`, **pinned exactly** to
the version OpenCode is built on (`effect` in `@opencode/plugin`'s dependencies;
`tests/config.test.mjs` enforces the match).
Effects interoperate across the host's copy and this one, but **Effect schemas do not**: the host
re-runs refinements (`Int`, `Finite`, min/max) with its own copy and rejects valid values
("Expected an integer"). So every schema the host validates (tool input, RPC
inputs/outputs/errors/events) goes through `portable()`, a plain Standard Schema (+ JSON Schema)
whose validation runs in this plugin's copy (`../shared/portable.ts`). A test asserts none of them
is an Effect schema.

Upgrading OpenCode: bump `@opencode/plugin` and `@opencode/schema` to the new CLI version and
`effect` to the exact version `@opencode/plugin` depends on in `plugins/package.json`, then
`npm install --prefix plugins` and `npm test`.

## Files

`domain.ts` (contract, schemas, parsing, cadence, packets) · `engine.ts` (watch fibers, delivery,
persistence) · `check.ts` (process-group runner) · `server.ts` (plugin, tool, RPC, events) ·
`rpc.ts` · `telemetry.ts` · `format.ts` · `view.js`/`tui.js` (dock, commands).

```sh
npm ci --prefix ..            # shared deps; arch/install and macos/install run it
npm run typecheck --prefix .. # strict TS: no any, assertions or non-null
node --test test/*.test.ts test/*.test.js
```
