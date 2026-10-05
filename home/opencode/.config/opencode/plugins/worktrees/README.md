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
`promise/worktree.ts`, `core/src/plugin/host.ts`, `core/src/worktree.ts`; live is 2.0.22.

## What runs where

Everything runs **inside `opencode.service` on Box** (user unit, `zsh -lc 'exec opencode
serve --service'`, cwd `$HOME`), not in a pane. Child processes get the plugin process's
own environment with every `HERDR_*` variable removed (`withoutPaneEnv`): the server's
Herdr identity is never trusted. Subprocesses are argv only (no shell), detached process
groups, SIGTERM then a grace and group SIGKILL on interruption/timeout (`runProcess` in
`../shared/process.ts`).

The plugin is an OpenCode Effect plugin (`server.ts`; shared deps in `../package.json`): the
strategy's `create`/`remove`/`list` are Effects, so cancelling an OpenCode worktree operation
interrupts the CLI and reaps its process group. CLI output is decoded with Effect Schema;
only sanitized, reported values reach errors.

| Strategy call | Command | Bound |
| --- | --- | --- |
| `create` | `worktree checkout --json --repo <sourceDirectory> --branch <decoded> [--base <input.branch>]` | 30 min, 3 s grace |
| `remove` | ownership-marker check, `git rev-parse --git-common-dir`, then `worktree-manage plan-checkout`, then `retire-checkout --expect-plan <token>` | 5 + 15 min |
| `list` | `git -C <sourceDirectory> worktree list --porcelain -z` + ownership markers (file reads) | 30 s |

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
`name: "feat--x"`. Reference implementation: `branchToName` in `naming.ts`, which throws
for branches with no exact encoding (no `/`, a segment containing `--`, or a segment
starting/ending with `-`). Never send `/` in `name`. Never rely on rules 2–3 for an
exact branch. The branch must not already exist (the CLI refuses before allocating);
if core suffixes a colliding `name` (`feat--x-2`), the suffix becomes part of the branch.

## Ownership marker

`worktree checkout` writes `dotfiles-worktree` into the new checkout's **private git
dir** (`git rev-parse --absolute-git-dir`, i.e. `<repo>/.git/worktrees/<id>/dotfiles-worktree`)
right after `git worktree add`, before provisioning — so a checkout whose provisioning
failed is still owned and retirable. Content: `{"strategy":"dotfiles","branch":"feat/x","createdAt":"<ISO>"}`.
It is never in the working tree and `git worktree remove` deletes it with the git dir.
Only a checkout whose marker names its current branch is owned. Herdr/Pi worktrees and
plain `git worktree add` checkouts have none. The plugin finds it through the
checkout's `.git` file (`gitdir: …`); `worktree-manage` checks it authoritatively via Git.

## `remove`

- A directory without the ownership marker is **refused** before anything runs
  (`… is not a dotfiles worktree (no ownership marker)`); `worktree-manage
  plan-checkout`/`retire-checkout` refuse it too, so the CLI is safe on its own.
- `force: true` is **refused** (no `forceRequired` signal, so the TUI shows an error).
- The primary checkout is derived from the target's Git common directory, then
  `worktree-manage plan-checkout` → `retire-checkout --confirm <dir> --expect-plan <token>`:
  refuses dirty/primary/current/locked/non-canonical checkouts, releases recorded
  `sandbox-db` leases, then `git worktree remove` (never `--force`), keeps the branch,
  writes private receipts under `~/.local/state/worktree-manager`.
- Errors include only worktree-manage's sanitized `worktree-manage: …` refusal line.
- **No agent checks.** OpenCode/Fleet must not delete a worktree that still has working
  sessions; that is the caller's responsibility.

## `list` and discovery

`git worktree list` of the source repository (bare/prunable records skipped). Only
linked checkouts carrying the marker for their current branch are `worktree` (owned by
`dotfiles`). Everything else — the primary, Herdr/Pi worktrees, plain `git worktree add`
checkouts — is reported as `root`.

Why not just omit unmarked worktrees: OpenCode's `refresh` asks **every** strategy, and
the built-in `git` strategy would claim anything we skip (its delete runs `git worktree
remove` and offers `--force` on dirty checkouts; no lease release, no plan token).
Reporting them as `root` makes core store them **unowned** (our strategy is consulted
first, so `git` never claims them): they still appear as checkouts in OpenCode, but
`worktree.remove` refuses them (no stored strategy) and nothing changes on disk. Retire
them through Herdr (`worktree-manage plan`/`retire --workspace`, `/worktrees`).
Discovery never replaces existing ownership, so rows OpenCode already stored as `git`
stay `git` (see go-live notes).

## Enabling live

Registered in this repo's `opencode.jsonc` `plugins`. To enable on Box: merge to
`~/.dotfiles` `main` (the `~/.config/opencode/plugins` and `~/.local/share/worktree`
stow links are directory symlinks, so no restow is needed), then
`systemctl --user restart opencode.service` (interrupts running sessions; the service
may also pick up the config change on its own config reload). Not enabled live by
this change.

Go-live notes:

- Checkouts created before this plugin have no marker and are never owned by `dotfiles`.
- The live DB already stores exactly one row as `git`-owned:
  `/home/magoz/dev/repos/duck-feat-project-sidebar-prototype` (project `48753e06…`).
  Discovery won't change it: it stays `git`-owned until it is retired by hand through
  `worktree-manage` (Herdr path) or the row is cleared. Until then, **do not delete it
  from OpenCode's UI** (that would run the built-in `git` strategy's removal).

## Validation

```sh
cd home/opencode/.config/opencode
node --test plugins/worktrees/test/*.test.js   # also part of the root `npm test`
# Opt-in, isolated end-to-end check against a throwaway `opencode serve` 2.0.22:
npm run test:worktrees-integration   # node plugins/worktrees/test/integration.mjs
```

Unit tests use real Git temp repos and fake `worktree` / `worktree-manage` CLIs on PATH.
`integration.mjs` starts an isolated server (temp HOME/XDG, random port/password, dead
proxy) that loads only this plugin, with this checkout's real CLIs and fake
`provision-env`/`sandbox-db`, and drives `worktree.create` / `list` / `remove` over HTTP.
