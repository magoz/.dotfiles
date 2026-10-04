# dotfiles-tools — `create_worktree` pane handoff

**Effect server + pane-local plain-JS TUI** plugin. Pi, shared skills, existing configs,
and the worktree CLI are untouched.

## Files

| File | Side | Role |
| --- | --- | --- |
| `server.ts` | server (Effect) | `create_worktree` tool, bridge RPC, session-end events, session cwd |
| `bridge.ts` | server (Effect) | pane request queue: leases, single claim, correlation, cancellation |
| `contract.ts` | shared | Effect Schemas; portable host schemas; exact decoders for the TUI |
| `worktree.ts` | shared | branch inference, `worktree create` argv, agent guidance |
| `view.js` / `tui.js` | TUI | binding, pulse/claim, confirmation, `/worktree`; `tui.js` injects Solid |
| `pane.js` | TUI | `provision-env` + `worktree create` with this pane's environment |
| `process.js` | TUI | Promise process runner (also used by `worktree-manager`) |

The server is an OpenCode Effect plugin (shared deps in `../package.json`). Host-validated
schemas (tool input/output, RPC) are `portable(..., { exact: true })`: unknown keys such as a
model-supplied `repo` are rejected. `Outcome` is a tagged union, so each status carries exactly
its own data. The TUI API is Promise-only, so that half stays plain JS and decodes RPC replies
with `contract.ts`.

## API baseline (historical V2.0.3 assessment; still accurate unless noted)

Assessed against the exact **V2.0.3** source downloaded under
`/tmp/opencode-v2-assessment/packages/` (not the older V1 SDK):

- `plugin/src/promise/plugin.ts`, `tool.ts`, `session.ts`, `event.ts`, `rpc.ts`,
  `README.md`: imperative `ctx.tool.transform(tools => tools.add(...))`, Promise
  executors/results, `ctx.session.get`, `ctx.event.subscribe`,
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
  `SessionInfo` directly.
- `plugin/src/tui/context.ts`: native `ctx.ui.router.current()`,
  `ctx.ui.dialog.confirm/prompt`, `ctx.keymap.layer`, `ctx.client.session.prompt`,
  and cached permission/form/pending sync/list. No invented UI command API.
- `plugin/src/host.ts`: resolver tries `server`, then default; TUI uses `tui`.
  `package.json` therefore exports `.`, `./server`, **`./tui`**. For a local
  directory the matching `server.ts` / `tui.js` also exist. Configure both
  sides with the **package directory**, not only the server file. Parent-owned
  config wiring is intentionally not included in this milestone.
- `core/src/tool.ts` and `plugin/src/promise/permission.ts`: tool
  `options.permission` filters wholly denied tools, but does **not** request
  permission. Promise plugins have no public permission-assert/request method.
  Thus every allocating operation uses a real, explicit **native local
  confirmation**, even with persistent allow rules.

Shell-condition watches (`until`) moved to `../until` (pi-until parity, no confirmation).

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
awaits its process-group cleanup; server unload cancels queued requests.

## Safety / remaining integration boundaries

This is for a **trusted local OpenCode server + local TUI on the same host**.
Remote-server attachment is unsupported: V2 does not expose a portable
same-host/pane-attestation primitive. A random client ID is a correlation
capability for cooperative installed plugins, not authentication against a
malicious process already authorized to call OpenCode RPC. Do not expose this
server RPC to untrusted clients. Multiple root-attached TUIs fail closed;
Web/headless clients cannot execute these pane operations.

Interrupting the tool call (Effect fiber interruption) withdraws its pane request. Session
interruption/deletion events also cancel requests created at or before the event, so an old
event never cancels a later run. A lost TUI RPC call aborts
local work within the heartbeat/request bounds. There is no atomic family lock;
a child starting after verification remains a race, another reason source auto
shutdown is disabled. Reviewer/manual host integration is still required for
actual loader wiring, terminal lifecycle and native dialog ergonomics.

## Validation

```sh
npm test --prefix home/opencode/.config/opencode   # typecheck + all plugin tests
# or, here: node --test test/*.test.ts test/*.test.js
```

Bridge tests run on `TestClock`; the JS integration tests drive the Effect server and the TUI
together through a fake RPC that runs the server's Effect handlers. They cover exact interface-shaped mocks, schemas,
CLI/Vercel behavior, root/family/permission/cwd correlation, server-vs-local pane
environments, single claims/leases/late replies, cancellation isolation,
cleanup and argv/process bounds. The Linux regression launches only harmless shell descendants and
verifies resistant descendants are gone after leader exit; that one `/proc`
test skips on other platforms. No real worktrees, DBs, panes or model calls.
