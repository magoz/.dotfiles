# Plugins

Local OpenCode runtime plugins.

## Integrations

- `subs-claude-gateway`: Effect plugin for `subs-claude` (CLIProxyAPI pool): content-only shaping,
  sentinel-URL fail closed. See its README. (The old direct Claude Pro/Max OAuth plugin was removed:
  it never loaded on 2.0.20, and the gateway replaced it.)
- `dotfiles-tools`: Effect server, `create_worktree` (any repo) + `/worktree`: preflight, native `worktree.create`
  (`worktrees` strategy), fresh session with the task (Fleet launcher's path). No TUI, Herdr or confirmation.
- `until`: Effect plugin (TS, own `effect` pinned to the host's; host-validated schemas must be `portable()`), pi-until parity (same tool contract): durable session watches/recurring wakes in plugin storage; no consent prompt, gated by `shell`; subagent watches belong to and wake the family root; composer dock + `/until*`.
- `herdr-opencode`: unchanged vendored V12; preserve provenance.
- `worktree-manager`: TUI-only, mixed-agent cleanup with exact plan and receipts.
- `worktrees`: Effect server worktree strategy `dotfiles` (Herdr-free `worktree checkout` + `retire-checkout`); `name` `feat--x` → branch `feat/x`; owns only checkouts with the private-git-dir `dotfiles-worktree` marker.
- `skill-commands`: Effect plugin; registers `/<id>` for shared skills with `metadata.opencode/slash: "true"`; runs as a skill-attached prompt.
- `subscription-usage`: Effect server (credential resolution, bounded cached fetch), sanitized on-demand TUI output.
- `fleet`: auto-discovered TUI-only Fleet client of `fleet.oox.sh` (sidebar, launcher, handled/undo via Fleet's JSON routes with `Origin`).

Effect plugins (server side only: the TUI API is Promise-only) are TypeScript `server.ts` files
sharing `plugins/package.json` (one `npm ci`, `effect` pinned to the host's version) and
`plugins/tsconfig.json` (strict; add each new plugin to `include`). Hand the host only
`shared/portable.ts` schemas: host-side checks of this copy's Effect schemas reject valid values.

Effect plugin pitfalls (each one has broken a plugin):

- One `effect` copy per plugin graph. Never give a plugin its own `node_modules` or deps:
  `shared/*.ts` resolves from `plugins/node_modules`, so a second copy mixes two Effect runtimes
  (seen as `TypeError: Cannot convert a Symbol value to a number` in `effect/dist/Order.js`).
- The config root's `node_modules` holds `effect` **3.x** (for `scripts/`). A plugin that resolves
  `effect` there fails with errors like `Schema.isMaxLength is not a function` or
  `Export named 'SchemaGetter' not found`; the tell is `.../opencode/node_modules/effect/dist/esm`
  in the error path (4.x has no `dist/esm`). Keep plugins under `plugins/`.
- The running service caches entrypoints and module resolution. After renaming or deleting a
  plugin's entry file (`server.js` -> `server.ts`) or changing plugin dependencies, restart it
  (`systemctl --user restart opencode.service`); a hot reload keeps failing (`ENOENT reading
  .../server.js`, or the wrong `effect` copy) even though a fresh service loads fine.
- `subs-claude-gateway` carries the agent's own model calls (`subs-claude`). Never edit it in
  place: work in a git worktree, verify there (tests, `npm run test:native`), then
  `git merge --ff-only <branch> && systemctl --user restart opencode.service` in one command.

CLI plugins must call `ctx.keymap.layer` inside a rendered slot/route (e.g. `append: 'app'`),
not directly in `setup`: V2 setup has no Keymap provider ("Keymap.Provider is missing").

See `../ASSESSMENT.md` and each plugin README. Skills and agents live in `~/.agents` and are
shared with Pi: fix harness differences in the shared text or `scripts/sync-agents.mjs`, never by
rewriting skills at runtime.
Run root `npm test`; no live resources or provider calls in tests.
