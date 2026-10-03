# worktrees — OpenCode worktree strategy `dotfiles`

Dependency-free **server** plugin. Registers worktree strategy `dotfiles` through
`ctx.worktree.transform((editor) => editor.add(...))`; an added strategy becomes the
selected default. Every OpenCode-native worktree then gets the same checkout as Pi's
`/worktree` — fresh origin base, sibling path, provisioning — without Herdr or an
agent launch:

- TUI: `ctrl+a` move dialog → new worktree;
- web app: "new workspace";
- Fleet launcher: `worktree.create` → `session.create` (in the returned directory) →
  `session.prompt`.

Removal always goes through the Herdr-free safe retirement path. No TUI plugin.
Contract checked against `~/dev/repos/opencode` (v2): `packages/plugin/src/worktree.ts`,
`promise/worktree.ts`, `core/src/plugin/host.ts`, `core/src/worktree.ts`; live is 2.0.20.

## What runs where

Everything runs **inside `opencode.service` on Box** (user unit, `zsh -lc 'exec opencode
serve --service'`, cwd `$HOME`), not in a pane. Child processes get the plugin process's
own environment with every `HERDR_*` variable removed (`dotfiles-tools/process.js`
`withoutPaneEnv`): the server's Herdr identity is never trusted. Subprocesses are argv
only (no shell), detached process groups, SIGTERM then a referenced grace and group
SIGKILL on cancel/timeout (`runProcess`, reused from `../dotfiles-tools/process.js`).

| Strategy call | Command | Bound |
| --- | --- | --- |
| `create` | `worktree checkout --json --repo <sourceDirectory> --branch <decoded> [--base <input.branch>]` | 30 min, 3 s grace |
| `remove` | `git rev-parse --git-common-dir`, then `worktree-manage plan-checkout`, then `retire-checkout --expect-plan <token>` | 5 + 15 min |
| `list` | `git -C <sourceDirectory> worktree list --porcelain -z` | 30 s |

After `create` returns, OpenCode records the worktree with strategy `dotfiles` and
runs the project's `commands.start` (`bash -lc`, with `OPENCODE_WORKTREE_BASE` /
`OPENCODE_WORKTREE_PATH`) in the new directory. That is OpenCode's step, not ours.

### Environment requirements (service PATH)

`git`, `bun`, `worktree`, `worktree-manage`, `provision-env` (from `home/scripts`);
`vercel` and `sandbox-db` for Vercel-configured repos. `git fetch` must work
non-interactively: the service has no SSH agent, so origin access relies on the
passphrase-less key in `~/.ssh/config`. Vercel/Neon credentials are whatever the
service user already has; nothing is prompted (`--non-interactive`).

## `create`

- **Branch**: decoded from OpenCode's `name`, which core turns into the last segment of
  the suggested directory (`path.join(<configured parent>, name)`). See encoding below.
- **Directory**: the suggested parent is **ignored**. The CLI always uses the sibling
  default `<primary-repo>-<branch-slug>` (e.g. `~/dev/repos/fleet-feat-x`) and the
  plugin returns the CLI's real path. OpenCode never creates `<parent>/<name>`.
- **Base**: OpenCode's `branch` input is a *starting ref*, passed as `--base` (used
  without fetching). Omitted → the CLI fetches origin's live default tip (fail closed).
- **Provisioning**: exactly `worktree checkout`'s rule (Vercel-configured repos get the
  full `provision-env --database`; others install dependencies only or skip, with
  warnings). See `home/scripts/.local/share/worktree/README.md`. Warnings are logged
  to the service journal as `[worktrees] <path>: <warning>`.
- **Failures** throw `Error`s built only from validated data (stage, branch, absolute
  path) of the CLI's JSON failure report. The CLI's stderr (provisioning/setup output)
  is discarded, never echoed. Preflight refusals allocate nothing; provision/setup
  failures preserve the checkout and say where it is. Run `worktree checkout` by hand
  for full diagnostics.

### Name → branch encoding (Fleet contract)

A worktree `name` cannot contain `/` usefully: core joins it into a path, and the
plugin only sees the final segment. Rules, in order:

1. **`--` separates branch segments exactly**: `feat--x` → `feat/x`,
   `fix--api--retry` → `fix/api/retry`. This is the canonical, reversible form.
2. No `--`, but a leading conventional type and `-`
   (`feat fix chore docs refactor perf test build ci style revert`): first `-` becomes
   `/`: `feat-x` → `feat/x`. (The TUI dialog slugifies `feat/x` to `feat-x` and can
   never produce `--`.)
3. Anything else gets `feat/`: `brave-cabin` (OpenCode's random slug) → `feat/brave-cabin`.

Names must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`; `--` segments must be non-empty
and must not start or end with `-`. The CLI then checks `git check-ref-format --branch`.

**Fleet must send `name = branch.replaceAll('/', '--')`** — for branch `feat/x`, send
`name: "feat--x"`. Reference implementation: `branchToName` in `naming.js`, which throws
for branches with no exact encoding (no `/`, a segment containing `--`, or a segment
starting/ending with `-`). Never send `/` in `name`. Never rely on rules 2–3 for an
exact branch. The branch must not already exist (the CLI refuses before allocating);
if core suffixes a colliding `name` (`feat--x-2`), the suffix becomes part of the branch.

## `remove`

- `force: true` is **refused** (no `forceRequired` signal, so the TUI shows an error).
- The primary checkout is derived from the target's Git common directory, then
  `worktree-manage plan-checkout` → `retire-checkout --confirm <dir> --expect-plan <token>`:
  refuses dirty/primary/current/locked/non-canonical checkouts, releases recorded
  `sandbox-db` leases, then `git worktree remove` (never `--force`), keeps the branch,
  writes private receipts under `~/.local/state/worktree-manager`.
- Errors include only worktree-manage's sanitized `worktree-manage: …` refusal line.
- **No agent checks.** OpenCode/Fleet must not delete a worktree that still has working
  sessions; that is the caller's responsibility.

## `list` and discovery caveat

`git worktree list` of the source repository: first record `root`, others `worktree`;
bare/prunable records skipped. OpenCode's `refresh` therefore adopts **every** linked
checkout of the repository as `dotfiles`, including Herdr-created ones. Do not delete
Herdr/Pi worktrees from OpenCode UIs; retire them with `worktree-manage` (Herdr path)
or `/worktrees`. The Herdr-free path still refuses dirty checkouts, but cannot see agents.

## Enabling live

Registered in this repo's `opencode.jsonc` `plugins`. To enable on Box: merge to
`~/.dotfiles` `main` (the `~/.config/opencode/plugins` and `~/.local/share/worktree`
stow links are directory symlinks, so no restow is needed), then
`systemctl --user restart opencode.service` (interrupts running sessions; the service
may also pick up the config change on its own config reload). Not enabled live by
this change.

## Validation

```sh
cd home/opencode/.config/opencode
node --test plugins/worktrees/test/*.test.js   # also part of the root `npm test`
# Opt-in, isolated end-to-end check against a throwaway `opencode serve` 2.0.20:
npm run test:worktrees-integration   # node plugins/worktrees/test/integration.mjs
```

Unit tests use real Git temp repos and fake `worktree` / `worktree-manage` CLIs on PATH.
`integration.mjs` starts an isolated server (temp HOME/XDG, random port/password, dead
proxy) that loads only this plugin, with this checkout's real CLIs and fake
`provision-env`/`sandbox-db`, and drives `worktree.create` / `list` / `remove` over HTTP.
