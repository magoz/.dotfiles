# Fleet terminal view

Fleet stage 3 inside `ocb`/`opencode`: every OpenCode session on Box by state, from the
Fleet service (`~/dev/repos/fleet`, `DESIGN.md` → Clients → Terminal). TUI-only; no server
plugin, RPC, model call or mutation. Plain JS, no build step.

- **Badge** on the home footer and the session prompt footer: `⚑ 2 need you · 3 working · 1 done`
  (non-zero states only). Hidden while Fleet is unreachable or everything is idle; muted while
  reconnecting or while Fleet itself lost OpenCode. Click opens the page.
- **Page** `ctrl+x f`, palette "Fleet", `/fleet`: needs you, failed, working, done (newest first),
  then idle (last 24h) collapsed. `j`/`k`/arrows select, `enter` opens the session, `o` opens
  its OpenCode web link with `open`/`xdg-open`, `i` toggles idle, `esc`/`q` goes back.
- **Next needs-you** `ctrl+x j`, palette "Next needs-you session": jumps to the newest
  needs-you session, cycling from the current one.

Keys: OpenCode 2.0.20 defaults (`packages/tui/src/config/keybind.ts`) leave `<leader>f` and
`<leader>j` unbound. Override via `cli.json` `keybinds` using ids `fleet.open` / `fleet.next`.

## Opening sessions in other projects

`ui.router.navigate({ type: 'session', sessionID })` is enough: the session route
(`routes/session/index.tsx`) loads the session by ID (`session.get`, not location-scoped) and
then `location.set(session.location)`, the same switch the open menu does eagerly. Viewing a
session with the terminal focused marks it seen natively (`session-tabs.tsx` → `session.view`).

## Data

`GET /api/fleet` on start, then SSE `GET /api/fleet/events`; every `initial: true` event
reloads the snapshot, as do changes naming an unknown project. 10s request timeout, 45s
heartbeat watchdog (Fleet sends one every 15s), reconnect 1s·2ⁿ capped at 30s; three failures in
a row = unreachable. JSON is shape-checked (`fleet.js`); bad rows are dropped. No credentials or
OpenCode password are sent; Fleet has no auth. Everything stops on plugin dispose.

Base URL: plugin option `url`, else env `FLEET_URL`, else `https://fleet.oox.sh` (tailnet-only,
publicly trusted certificate, so the Macs need no extra CA).

## Notifications

OpenCode's builtin `opencode.notifications` already notifies (terminal blurred) for every
**root** session server-wide on permission, question and done, and only plays a sound for
subagents. So Fleet by default (`notify: "gaps"`) sends a blurred-terminal notification only when
a root session enters needs-you because of a **subagent's** permission/question. `notify: "all"`
adds root needs-you and done (duplicates the builtin); `"off"` disables. Transitions are diffed
between consecutive Fleet states (never on the first snapshot), batched for 1.5s, and each
session/state pair is notified at most once a minute. No sound (the builtin already plays one).

Options require a `cli.json` entry, e.g.
`{ "package": "./plugins/fleet", "options": { "notify": "all" } }`.

## Files and tests

`fleet.js` pure model, `source.js` snapshot + SSE, `view.js` UI (OpenTUI Solid runtime injected,
elements built with a tiny hyperscript), `tui.js` host entry. Commands register inside an
`app` slot: V2 setup has no Keymap provider. Tests (`node --test plugins/fleet/*.test.js`, part
of root `npm test`) use fake fetch, timers and runtime; never the live Fleet.
