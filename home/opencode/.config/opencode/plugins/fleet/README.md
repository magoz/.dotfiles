# Fleet terminal view

Fleet's terminal client inside `ocb`/`opencode` on the Mac (`~/dev/repos/fleet`, `DESIGN.md` →
Clients → Terminal): what needs me across every OpenCode session on Box, a launcher for repos and
new worktrees, and Handled / Undo. It is TUI-only (no server plugin, RPC or model call), plain
dependency-free ESM, and uses no build step. States come from Fleet and the plugin never computes
them. The only time-based rule it applies itself is Fleet's "stuck" rule (quiet after 10 minutes).

## What's where

| File | Role |
|---|---|
| `fleet.js` | Pure model: wire shape checks, live rows, needs-me and working order, counts, badge, row reasons, notification transitions, launcher options, options (`url`, `notify`, `keys`) |
| `source.js` | `GET /api/fleet` snapshot plus `GET /api/fleet/events` SSE: timeouts, heartbeat watchdog, reconnect |
| `api.js` | Every other Fleet route: launcher list, branch suggestion, run summaries, JSON mutations (with `Origin`) |
| `launcher.js` | Launcher dialog flow, and the watch that lands in a launched session when it is ready |
| `view.js` | Host wiring: focus sidebar, footer badge, page, commands, handled/undo, notifications |
| `tui.js` | Entry: injects OpenTUI Solid (`@opentui/solid`, `solid-js`, both resolved to the host's copies) |
| `payloads.json`, `payloads.gen.ts` | Real Fleet payloads for the tests (see Tests) |
| `fixtures.js`, `*.test.js` | Fakes (fetch, timers, runtime, host) and tests |

## Focus sidebar

The plugin claims `sidebar.content` with `replace`. OpenCode keeps the sidebar's title and footer,
but its own content (context, MCP, LSP, todos and other plugins' claims inside the slot) is
replaced. From top to bottom the sidebar shows:

- **Launches**: provisioning, starting the session, failed (with what was kept), and ready
  (`ready · open session`). Each shows `branch · repo` and an elapsed clock. Settled launches have
  a `× dismiss` line.
- **Blocked**, longest wait first, then **Finished**, oldest first. Each row has a state marker
  (`■` blocked, `▪` finished, red when the run failed) and its `project · worktree` and age, then
  its title, then a short reason:
  - blocked: the first permission (`bash: pnpm db:push`) or question title, `<agent> asks: …`
    for a subagent, and `(+N)` when more are waiting;
  - finished: `run failed`, `stopped by OpenCode` or `interrupted`, otherwise the first line of
    the answer when Fleet has it, otherwise nothing.

  The current session (the slot's `sessionID`, by root) is highlighted.
- Below the list are `N working · N stuck` and key hints. When nothing needs me, the list is
  replaced by "Nothing needs you".

Clicking a row opens its session (`router.navigate({ type: 'session', sessionID })`). Permissions
and questions are answered natively there. Clicking a ready launch opens its session, `× dismiss`
dismisses the launch, and the `✓ handled … · undo` line (shown for 5 minutes after a handled)
undoes it.

These are OpenCode 2.0.20 facts (`packages/tui/src`) that shape the sidebar:

- **The sidebar is on the right only.** `session.sidebar` is `"auto" | "hide"`. `cli.json` sets
  `"auto"`, which shows the sidebar when the terminal is wider than 120 columns (minus vertical
  tabs). `ctrl+x b` toggles it, and below that width it opens as an overlay. There is no
  left-side option: the "left" and "orientation" keywords in the settings dialog belong to
  `tabs.layout`. Subagent sessions never show the sidebar.
- **The sidebar cannot take keyboard focus.** The renderer runs with `autoFocus: false`
  (`app.tsx`), so clicks never focus anything. `session-frame.tsx` never makes the sidebar the
  active pane, and the prompt takes focus back on every dialog or visibility change. Only
  `session.panel` has a host input scope. Rows are therefore mouse-clickable, and every key is a
  global leader command (`ctx.keymap.layer` inside the rendered `app` slot, mode `global`). Bare
  `h`/`u`/`j`/`k` keys inside the sidebar are not possible.

## Keys

| Key | Palette | What |
|---|---|---|
| `ctrl+x f` | Fleet (also `/fleet`) | The page |
| `ctrl+x j` | Fleet: Next needs-me session | The next needs-me session after the current one, in sidebar order, wrapping |
| `ctrl+x o` | Fleet: New / open | The launcher |
| `ctrl+x h` | Fleet: Mark handled | Marks the current session's root handled (finished sessions only) |
| `ctrl+x z` | Fleet: Undo handled | Reopens the last session marked handled here |

The defaults use leader keys that OpenCode 2.0.20 leaves unbound (`config/keybind.ts`).
`<leader>n` is `session.new` and `<leader>u` is `session.undo`, so the launcher uses `o` and undo
uses `z`. The leader key is OpenCode's: `ctrl+x` unless `cli.json` changes it.

**Plugin command ids cannot be rebound through `cli.json` `keybinds`.** That schema only knows
OpenCode's built-in ids and rejects unknown keys. Use the plugin option `keys` instead:
`{ open, next, launcher, handled, undo }`, each a binding string, or `false` to unbind.

## Page

`ctrl+x f` opens a full-screen list: blocked, then finished (each with its reason and age), then
working, stuck first, with `retrying (2×, …)` / `quiet 14m` or the live activity. Handled sessions
are not listed. Keys: `j`/`k`/arrows select, `enter` opens, `h` marks the selected session
handled, `o` opens its OpenCode web link (`open`/`xdg-open`), and `esc`/`q` go back.

## Handled and undo

Handled works only on a finished root session. The row leaves the list immediately, as an
optimistic override that holds until Fleet sends anything new for that row. Then the plugin
calls `POST …/handled`. If that call fails, the row comes back and a toast shows Fleet's message
(for example `Only a finished session can be marked handled`). After success, a toast names the
undo key and the sidebar shows the undo line. Undo calls `POST …/reopen`. An outcome of
`already-handled` or `not-handled` is not an error.

## Launcher

`ctrl+x o` shows OpenCode's select dialog over `GET /api/fleet/launcher`, with one category per
repository in Fleet's order (most recent agent activity first). Each category lists:

- the repository, with its session tallies;
- its worktrees (`branch`, `pi` for non-dotfiles worktrees, the PR state);
- `+ New worktree in <repo>…`.

The dialog's own fuzzy filter matches titles and categories, so typing a repository name keeps
all of its rows.

- **Enter on a repository or worktree** calls `POST /api/fleet/checkouts/open`
  `{ directory }`, which returns the latest root session or a new empty one, and opens that
  session. If the deployed Fleet has no such route (404/405 without Fleet's error body), the
  plugin opens the entry's `latestSession` instead.
- **New worktree** prompts for the task, then calls `POST /api/fleet/launcher/branch` and shows
  the suggestion in an editable prompt (a model call, so it can take a few seconds). Then it calls
  `POST /api/fleet/launches` `{ repoDir, branch, task }`, which returns at once. The launch shows
  in the sidebar. When it is `ready` with a `sessionID`, the plugin opens that session only if the
  current route is still the one the launch was started from. Otherwise a toast offers it with
  OpenCode's Open action. A failure toasts Fleet's message.

## Data and routes

Base URL: plugin option `url`, else env `FLEET_URL`, else `https://fleet.oox.sh`. The site is
tailnet-only but has a publicly trusted certificate, so the Macs need no extra CA.

| Route | Use |
|---|---|
| `GET /api/fleet` | Snapshot (`FleetSnapshot`: projects → worktrees → rows, `launches`) on start and after every `initial` event, or when a change names an unknown project |
| `GET /api/fleet/events` | SSE `fleet.changed` (`rows`, `removed`, `launches` when any changed). 45s heartbeat watchdog (Fleet sends one every 15s); reconnect 1s·2ⁿ capped at 30s; three failures in a row = unreachable |
| `GET /api/fleet/sessions/:id/summary?idle=` | Answer excerpt for finished rows: lazy, 2 at a time, cached per run (Fleet caches it too); failures are not retried |
| `GET /api/fleet/launcher` | Launcher list (`LauncherList`) |
| `POST /api/fleet/launcher/branch` | `{ task }` → `{ branch, source }` |
| `POST /api/fleet/sessions/:id/handled` | `{}` → `{ sessionID, outcome: 'handled' \| 'already-handled' }` |
| `POST /api/fleet/sessions/:id/reopen` | `{}` → `{ sessionID, outcome: 'reopened' \| 'not-handled' }` |
| `POST /api/fleet/launches` | `{ repoDir, branch, task }` → `{ launchID }` |
| `POST /api/fleet/launches/:id/dismiss` | `{}` → `{ launchID }` |
| `POST /api/fleet/checkouts/open` | `{ directory }` → `{ sessionID, created }` |

**Origin rule.** Fleet guards its JSON routes with the web's same-origin check. `Origin`'s host
must equal `Host` (or `X-Forwarded-Host`), and `Sec-Fetch-Site`, if sent, must be `same-origin`.
Then the body must be `application/json` (else 415). Every `POST` here therefore sends
`Origin: <the base URL's origin>` and `content-type: application/json`. Bun (OpenCode's runtime)
and Node both send `Origin` as given and send no `Sec-Fetch-Site`. Failures are
`{ error }` with 400/403/404/409/415/502/503. The plugin shows that message as is. A request
times out after 10s (20s for the launcher list, 30s for branch suggestions).

No credentials and no OpenCode password are sent, since Fleet has no auth. Everything that comes
over the wire is shape-checked against Fleet's wire types (`lib/data/fleet/types.ts`):

- rows, child rows and launches with a wrong core field are dropped;
- display text is cleaned (single line, bounded, no control characters);
- web links must be http(s).

Ordering mirrors Fleet (`board.ts`, `state.ts`):

- blocked rows sort by `activeAt` ascending (longest wait first), finished rows oldest first;
- working rows sort stuck first, then newest `created`;
- stuck means a working row that is retrying, or one whose running subtree has had no activity
  for 10 minutes.

Counts are `{ blocked, finished, working, stuck, handled }`.

## Badge

The badge appears on the home footer and the session prompt footer:
`⚑ 7 need you · 3 working · 2 stuck` (`1 needs you` in the singular), non-zero parts only. It is
hidden while Fleet is unreachable or when nothing needs me and nothing is working. It is muted
while reconnecting, or while Fleet itself has lost OpenCode. Clicking it opens the page.

## Notifications

OpenCode's builtin `opencode.notifications` already notifies (terminal blurred) for every **root**
session on permission, question and done, and only plays a sound for subagents. So Fleet's
default (`notify: "gaps"`) sends a blurred-terminal notification only when a root session becomes
**blocked because of a subagent** (its own state is not blocked). `notify: "all"` adds root →
blocked and → finished (never a reopen), which duplicates the builtin. `"off"` disables them.

Transitions are diffed between consecutive Fleet states (never on the first snapshot) and batched
for 1.5s. Each session/state pair notifies at most once a minute. No sound plays, because the
builtin already plays one.

## Options

The plugin is auto-discovered from `plugins/fleet`. Options need an explicit `cli.json` entry,
which is merged with the discovered one:
`{ "package": "./plugins/fleet", "options": { "url": "https://…", "notify": "all", "keys": { "launcher": "<leader>p" } } }`.

## Trying it once Fleet's routes are live

The mutation routes are on Fleet's `terminal-json-routes` branch, not yet deployed. Until they
are:

- the sidebar, badge, page and notifications work against any Fleet serving the current wire
  types (Fleet `main`'s `types.ts` matches the branch's up to the new result schemas);
- handled, undo and launches toast `Fleet answered 404`;
- the launcher's open action falls back to the entry's latest session.

1. On Box, after the branch is merged, deploy Fleet the usual way (`pnpm ship`). The Fleet owner
   does this; it is not part of this plugin.
2. Check the read side from the Mac:
   `curl -s https://fleet.oox.sh/api/fleet | jq '.counts, (.launches | length)'`.
3. Check that the guard and route exist without mutating anything. An unknown id gives 404:
   `curl -s -X POST -H 'content-type: application/json' -H 'origin: https://fleet.oox.sh' -d '{}' https://fleet.oox.sh/api/fleet/sessions/does-not-exist/handled`
   should print `{"error":"Session not found"}`. Without the `origin` header it should print
   `{"error":"Request rejected"}`.
4. Restart `ocb` (the dotfiles are stowed, so the plugin is live once this branch is merged). Open
   a finished session and try `ctrl+x h`, then `ctrl+x z`; try `ctrl+x o` → a repository; try
   `ctrl+x o` → `+ New worktree…` on a scratch repository.

## Tests

`node --test plugins/fleet/*.test.js` is part of the root `npm test`. The tests use fake fetch,
timers, runtime and host, and never the live Fleet or OpenCode.

`payloads.json` holds real wire payloads: a snapshot covering every state, a subagent ask, a
"stopped by OpenCode" run, a deleted folder, stuck rows and launches, plus a change, a launcher
list, a summary and the route results. Fleet's own `buildSnapshot` builds them and Fleet's schemas
decode them. To regenerate it, run `payloads.gen.ts` from a Fleet checkout that has the JSON
routes: `node_modules/.bin/tsx <plugin>/payloads.gen.ts > <plugin>/payloads.json`.
