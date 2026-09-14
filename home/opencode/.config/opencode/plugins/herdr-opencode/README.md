# Herdr OpenCode V2 bridge

Unmodified official integration v12 assets from `herdrdev/herdr` commit
`bafbc0949dd996cf7fd0848c8965e254348cc11e`:

- `src/integration/assets/opencode/herdr-agent-state.js` → `server.js`
- `src/integration/assets/opencode/herdr-tui-session.js` → `tui.js`

Apache-2.0; license included. Local package manifest only wraps these files.
The TUI owns pane identity and working/blocked/idle reporting, including child
sessions. The shared-server V2 entrypoint is intentionally a no-op.

Installed Herdr 0.9.0's `integration install opencode` still writes V11. This
pinned bridge uses V0.9.0-compatible socket fields without updating the running
Herdr server or its Pi integration. It is registered by dotfiles `cli.json`,
not Herdr's managed-path status detector. Do not replace it with V11.

When upgrading, inspect upstream diffs and API compatibility before replacing
both assets; never run a blanket integration update that overwrites Pi's hooks.
