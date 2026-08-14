# worktree

`worktree` creates one Git worktree through Herdr, provisions it for local
development, and launches a fresh named Pi session in the new Herdr workspace.
Every entry point calls the same CLI so the lifecycle stays identical.

## Pi-only quick start

For local work without a GitHub issue:

```text
/worktree Fix the resource-card fallback title
```

Pi infers a branch such as `fix/resource-card-fallback-title`. Use an exact branch
only when needed:

```text
/worktree --branch fix/card-title Fix the resource-card fallback title
```

For an implementation-ready GitHub issue:

```text
/skill:implement-issue 212
```

Both flows create and provision a sibling checkout, open its grouped Herdr
workspace, start a fresh Pi with the task as its initial message, focus it, and
shut down the source Pi after successful handoff.

### First-use project trust

Every worktree is a new filesystem path, so Pi may pause at `Trust project folder?`
before processing its initial task. This is expected; approving trust immediately
continues the queued task.

- `Trust` remembers only that worktree path.
- `Trust parent folder` avoids future prompts but, with sibling worktrees under
  `~/dev/repos`, trusts every repository below that directory.
- Session-only trust applies only to the current Pi process.

The launcher intentionally does not pass `--approve`; project trust remains an
explicit user security decision.

## Requirements

- a running Herdr server with the Pi integration installed;
- `git`, `bun`, `herdr`, `pi`, `vercel`, `provision-env`, and `sandbox-db` in `PATH`;
- a source Git checkout linked to Vercel, or exactly one linked sibling checkout;
- ignored `.env.local`, `.env.test`, and `.vercel/` paths in the repository;
- the project-local sandbox database profile expected by `provision-env`, or valid global `sandbox-db` authentication.

## CLI reference

```sh
worktree create \
  --repo /path/to/source-checkout \
  --branch feat/reporting \
  --base origin/main \
  --prompt "Implement the reporting workflow"
```

`--repo` defaults to the current directory. When `--base` is omitted, the CLI
uses `origin/HEAD` when configured, then tries `origin/main`, `main`,
`origin/master`, and `master`, and finally falls back to `HEAD`.

By default, the CLI places the checkout beside the primary repository using
`<repo>-<branch-slug>`, even when invoked from another linked worktree:

```text
~/dev/repos/speldosa-discussion-issue-212
```

It passes this as Herdr's explicit `--path`, which changes only filesystem placement;
Herdr still groups the workspace beneath its repository parent and retains native
list/open/focus/remove behavior. Pass `--path` only to override this convention.

## Pi entry point

The global Pi extension registers:

```text
/worktree <task description>
/worktree <conventional/branch> [kickoff prompt]
/worktree --branch <exact-name> [kickoff prompt]
```

A task-only command is routed through the current agent. It infers a concise
conventional branch and calls `create_worktree`; when the worktree intent or branch
choice is genuinely ambiguous, it asks before creating anything. Running
`/worktree` without arguments opens a task-description input.

The structured `create_worktree` tool is also used by workflow skills. Its branch
field is optional when a kickoff prompt is available. After the CLI verifies the
destination Pi, the extension gracefully shuts down the source Pi. If creation or
provisioning fails, the source stays alive.

`implement-issue` uses the same tool and hands the destination Pi to the internal
`implement-issue-worktree` continuation skill, so issue-driven and local creation
have the same session lifecycle.

## Repository setup

`provision-env` deliberately does not prepare a repository schema. Pass one or
more explicit setup commands when the new checkout needs additional bootstrap:

```sh
worktree create \
  --branch feat/reporting \
  --setup "pnpm db:push" \
  --setup "pnpm db:seed"
```

Setup commands run in order from the new checkout through the user's login
shell. They are trusted local commands supplied by the caller; the CLI does not
guess repository-specific schema or seed operations.

## Lifecycle

In order, `worktree create`:

1. resolves the source Git checkout, primary repository, base ref, and sibling checkout path;
2. calls `herdr worktree create --path ...`, which creates both the checkout and its grouped Herdr workspace;
3. resolves the workspace's initial root pane;
4. runs `provision-env --database`, pulling Development and `test` Vercel variables and creating independent database leases for both;
5. runs every explicit `--setup` command;
6. starts a fresh named Pi session with the kickoff task as Pi's initial message;
7. verifies the Pi session is ready with the startup task attached;
8. focuses the destination workspace.

The CLI never moves or forks the caller's Pi session. A Pi adapter may shut down
the caller only after this command succeeds, leaving one active Pi in the new
worktree.

## Failure and recovery

`provision-env` owns rollback of newly pulled `.env.local` and `.env.test` files
and database leases created by that invocation. After Herdr has created the checkout, this CLI preserves the
worktree, branch, and workspace on later failure so the exact state can be
inspected and resumed. It never force-removes a checkout or deletes a branch.

The kickoff task is passed directly on Pi's launch argv, avoiding a race where
terminal input sent immediately after startup could be lost. Once Pi is confirmed
ready, handoff is considered successful. A later workspace-focus failure is reported
as a warning while the command still exits successfully, allowing Pi adapters to
shut down the source instead of leaving two active sessions.

## Development

```sh
cd ~/.dotfiles/scripts/.local/share/worktree
bun install
bun test
bun run typecheck
```
