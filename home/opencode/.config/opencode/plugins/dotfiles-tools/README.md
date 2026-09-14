# dotfiles-tools — OpenCode V2.0.3 assessment

Opt-in, dependency-free **Promise server + pane-local TUI** plugin. Pi, shared
skills, existing configs, and the worktree CLI are untouched. No skill toggle,
compaction, Plannotator, Herdr vendor, quota, or configuration migration here.

## Entry points / API baseline

Plain ESM JavaScript exports structural `{ id, setup }` definitions; V2's
`Plugin.define` is an identity helper. No V1 hooks, SDK casts, `any`, or bundled
Effect runtime. Portable JSON schemas plus explicit runtime validation protect
inputs, RPC replies, and CLI success results. No dependency install required.

Assessed against the exact **V2.0.3** source downloaded under
`/tmp/opencode-v2-assessment/packages/` (not the older V1 SDK):

- `plugin/src/promise/plugin.ts`, `tool.ts`, `session.ts`, `event.ts`, `rpc.ts`,
  `README.md`: imperative `ctx.tool.transform(tools => tools.add(...))`, Promise
  executors/results, `ctx.session.get/synthetic`, `ctx.event.subscribe`,
  `ctx.rpc.register`, and awaited setup cleanup / registration disposal.
- `schema/src/tool.ts`, `rpc.ts`, `session.ts`, `location.ts`, `session-event.ts`:
  portable JSON schemas, `sessionID` tool context (no tool AbortSignal!),
  `Session.Info.location/subpath/parentID`, and events with `data.sessionID` and
  millisecond `created` timestamps. Interrupted/deleted events cancel current
  operations; no permanently aborted per-session controller is reused.
- `client/src/promise/rpc.ts`: **`ctx.client.rpc(definition).method(input,
  { location, signal })`**. Every TUI call uses the bound root's location,
  including release. Server-local RPC registration is location scoped.
- `client/src/promise/generated/types.ts`: `SessionListOutput` is
  `{ data: SessionInfo[], cursor: { previous?, next? } }`; session get returns
  `SessionInfo` directly. Synthetic input is `{ sessionID, id, text,
  description, metadata, delivery: 'queue', resume: true }`.
- `plugin/src/tui/context.ts`: native `ctx.ui.router.current()`,
  `ctx.ui.dialog.confirm/prompt`, `ctx.keymap.layer`, `ctx.client.session.prompt`,
  and cached permission/form/pending sync/list. No invented UI command API.
- `plugin/src/host.ts`: resolver tries `server`, then default; TUI uses `tui`.
  `package.json` therefore exports `.`, `./server`, **`./tui`**. For a local
  directory the matching `server.js` / `tui.js` also exist. Configure both
  sides with the **package directory**, not only the server file. Parent-owned
  config wiring is intentionally not included in this milestone.
- `core/src/tool.ts` and `plugin/src/promise/permission.ts`: tool
  `options.permission` filters wholly denied tools, but does **not** request
  permission. Promise plugins have no public permission-assert/request method.
  Thus every allocating operation and every `until start` uses a real,
  explicit **native local confirmation**, even with persistent allow rules.
  `until` additionally sets `options.permission: 'shell'`. This extra confirmation
  is an assessment safety choice, not an imitation permission API.

## Worktree handoff

Use `/worktree <task>` in an existing root session; it queues a native user
prompt asking the current agent to invoke `create_worktree`. Or explicitly ask
the agent to call the tool with:

```json
{"prompt":"Implement the requested task","branch":"feat/task","setup":["npm ci"]}
```

`branch`, `base`, `path`, `label`, `ttl`, `prompt`, `setup` follow the Pi helper's
behavior. Branch can be inferred from the prompt; omit base to freshly fetch
origin's default-branch commit. Never bypass failed fetching with a local base.
TTL is CLI-default 7d when omitted; repeated setup argv are preserved. Repo/cwd
are **not model parameters**: the server resolves session location + relative
subpath, rejects escapes and cross-location sessions, and enforces root-only.

The server never allocates or reads its inherited HERDR pane/socket identity.
It queues a one-shot request for exactly one live TUI bound to that root. The
TUI registers/heartbeats (1s; 6s lease), claims once, validates its exact route,
root/location/cwd, and full paginated family. Running, blocked, queued, or
unverifiably idle children fail closed. Family verification is conservative:
updated-after-idle children (even title-only updates) are rejected; at most 256
family members. Permission/form state is refreshed. Unknown state is not idle.

The TUI shows exact argv, cwd, setup and bounds for human approval, rechecks
correlation, verifies **its own** `HERDR_ENV=1`, then executes using **its own**
environment:

1. `provision-env --repo <session cwd> --check-vercel-link --non-interactive`
   (30s, before allocation).
2. Only exit 3 with strict `{status:'vercel_link_required',directory,reason}`
   stderr becomes a structured recoverable result with identical retry args.
   The agent must investigate verified Vercel repo/rootDirectory/team/project
   identity, keep `.vercel` ignored, and request help for genuine ambiguity or
   authentication. No blind `vercel link --yes`, remote creation/deploy/settings
   changes, credential output, or symlink following. All unknown failures stop.
3. `worktree create --agent opencode --json --repo ...` (30 minute bound).
   Success must match the exact CLI `CreatedEnvironment` fields:
   `source, branch, base, path, workspaceId, paneId, agentName, agentKind,
   warnings`; **`agentKind` must equal `opencode`**, and branch must correlate.
   The CLI's successful return is its ready-destination contract.

**Source is deliberately retained. Destination owns the task: do not continue
implementation in the source. Review the result/destination, then manually exit
only this source TUI.** V2 exposes no safe tool-result-delivery + local-exit
transaction. This assessment therefore does not call interrupt or autoexit,
including after RPC acknowledgement; it never broadcasts `tui.command.execute`
or stops the shared service. A future safe automatic close must correlate the
exact source session/client, acknowledge result delivery, reverify family and
local tabs, use `ctx.client.session.interrupt({sessionID: exactSourceID})`, then
**local-only** `ctx.keymap.dispatch('app.exit')`. Neither primitive is needed or
used in this retained-source implementation.

On cancellation, timeout, ambiguous client, route change, disconnect, malformed
success or lost acknowledgement: retain source and all partial resources;
inspect before retrying. No rollback or automatic allocation retry. Worktree
stderr is discarded after preflight to avoid leaking provisioning secrets.
Captured CLI JSON/preflight output is bounded to 64KiB. TUI disposal aborts and
awaits its process-group cleanup; server unload cancels queues and until jobs.

## `until`

Examples (tool use; no `/watch` aliases are installed):

```json
{"action":"start","command":"test -f build/ready","intervalMs":5000,"timeoutMs":10000,"runtimeMs":3600000}
{"action":"list"}
{"action":"status","id":"<returned job id>"}
{"action":"cancel","id":"<returned job id>"}
```

Start currently requires a unique, active **root TUI** for confirmation of the
exact shell command, session, cwd and bounds. Checks then run server-side using
`/bin/sh -c` with **every `HERDR_*` variable removed**. Commands MUST be
side-effect-free by contract. This is **not a shell sandbox**; approval is
required even for nominally read-only commands. Other ordinary environment
credentials may still be available to an approved shell; do not use commands
that transmit or mutate them.

- Default interval/check timeout/runtime: 5s / 10s / 1h.
- Allowed: interval 1–60s; check timeout 100ms–60s, no larger than runtime;
  runtime 1s–24h. At most 8 running jobs/session, 64 retained jobs/session,
  and 1024 jobs/plugin location.
- Nonzero exit schedules a timer for another check. No agent-side sleeping,
  overlapping scheduler checks or sleeping shell loop is generated. A process
  timeout/spawn error stops the job, rather than silently retrying forever.
- Exit zero initiates exactly **one** synthetic enqueue attempt with a stable
  `msg_` ID, `delivery:'queue'`, `resume:true`, and only opaque job ID + success
  text. No command, stdout, stderr, cwd or secret is included in status/wakes.
  Both output streams use OS-level discard, not retained buffers.
- Jobs are session-owned; cross-session status/cancel is rejected. Deletion,
  interruption, explicit cancellation and plugin unload abort processes/timers.
  SIGTERM is followed by a referenced 250ms grace timer and final process-group
  SIGKILL even if the leader already exited. Cleanup awaits that grace.
- Wakes are not retried on transport failure (`wake_failed`), avoiding duplicate
  resumptions. Admission and cancellation cannot be atomic across a network:
  an already accepted wake cannot be recalled by a late cancellation. State is
  in-memory, not persisted/replayed after reload; exactly-once is local enqueue
  behavior, not a durable distributed delivery guarantee.

## Safety / remaining integration boundaries

This is for a **trusted local OpenCode server + local TUI on the same host**.
Remote-server attachment is unsupported: V2 does not expose a portable
same-host/pane-attestation primitive. A random client ID is a correlation
capability for cooperative installed plugins, not authentication against a
malicious process already authorized to call OpenCode RPC. Do not expose this
server RPC to untrusted clients. Multiple root-attached TUIs fail closed;
Web/headless clients cannot execute these pane operations.

V2 lacks a public per-tool AbortSignal; interruption uses durable event timestamps
and cancels only operations that existed when that event was created. New calls
have fresh controllers; old events cannot leave a sticky cancelled session.
Event stream failure disables the plugin until reload. A lost TUI RPC call aborts
local work within the heartbeat/request bounds. There is no atomic family lock;
a child starting after verification remains a race, another reason source auto
shutdown is disabled. Reviewer/manual host integration is still required for
actual loader wiring, terminal lifecycle and native dialog ergonomics.

## Validation

```sh
cd home/opencode/.config/opencode/plugins/dotfiles-tools
npm test
# or: node --test test/*.test.js
```

26 dependency-free Node tests cover exact interface-shaped mocks, schemas,
CLI/Vercel behavior, root/family/permission/cwd correlation, server-vs-local pane
environments, single claims/leases/late replies, cancellation isolation,
until ownership/bounds/output suppression/wakes, cleanup and argv/process
bounds. The Linux regression launches only harmless shell descendants and
verifies resistant descendants are gone after leader exit; that one `/proc`
test skips on other platforms. No real worktrees, DBs, panes or model calls.
