# worktree

`worktree` creates one Git worktree through Herdr, provisions it for local
development, and launches a fresh agent in the new Herdr workspace. Pi remains
the default; `--agent opencode` explicitly selects the additive OpenCode assessment.
Existing Pi entry points are unchanged and continue to use Pi.

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
workspace, start a fresh Pi, submit the task as its first prompt once Pi is
ready, focus it, and shut down the source Pi after successful handoff.

### First-use project trust

Every worktree is a new filesystem path, so Pi may pause at `Trust project folder?`
before becoming interactive. This is expected; after trust is approved, Herdr
submits the queued kickoff task.

- `Trust` remembers only that worktree path.
- `Trust parent folder` avoids future prompts but, with sibling worktrees under
  `~/dev/repos`, trusts every repository below that directory.
- Session-only trust applies only to the current Pi process.

The launcher intentionally does not pass `--approve`; project trust remains an
explicit user security decision.

## Requirements

- a running Herdr server with the selected harness integration installed;
- `git`, `bun`, `herdr`, `vercel`, `provision-env`, and `sandbox-db` in `PATH`, plus `pi` (default) or `opencode` for the selected harness;
- a source Git checkout linked to Vercel, or sibling checkouts sharing one Vercel identity (Pi can resolve a missing link before creation);
- ignored `.env.local`, `.env.test`, and `.vercel/` paths in the repository;
- the project-local sandbox database profile expected by `provision-env`, or valid global `sandbox-db` authentication.

## CLI reference

```sh
worktree create \
  --repo /path/to/source-checkout \
  --branch feat/reporting \
  --prompt "Implement the reporting workflow"
```

### Harness selection and machine-readable results

`--agent pi|opencode` is validated before any Git, Herdr, or provisioning commands.
Omitting it is exactly equivalent to `--agent pi`; existing Pi launch arguments
and the default human-readable success summary remain unchanged.

```sh
worktree create --agent opencode --branch feat/oc-assessment \
  --prompt "Assess the reporting workflow" --json
```

OpenCode starts with `herdr agent start NAME --kind opencode --pane ID --timeout
120000`, without Pi's `-- --name LABEL` arguments. Both harnesses use the same
fetch, Vercel/environment/database provisioning, setup, readiness verification,
and single kickoff path. OpenCode authentication, permissions, and project trust
must already be usable or be resolved interactively; the CLI does not approve or
bypass them.

`--json` emits one success object on stdout, with `source`, `branch`, `base`,
`path`, `workspaceId`, `paneId`, `agentName`, `agentKind`, and `warnings` fields.
Progress, warnings, and provisioning/setup stdout and stderr go to stderr.
Creation/validation failures exit nonzero with stderr diagnostics and no success
object; callers must check the exit status, not just parse stdout. Help/version
are ordinary CLI informational output, not this creation-result interface.
`agentName` is the requested Herdr alias (not an OpenCode session ID); after timeout
recovery the alias may be unavailable, so use `paneId` to address the agent.

OpenCode's `dotfiles-tools` plugin launches this CLI through the invoking TUI's
pane-local environment, never the shared server's environment. Source-session
shutdown is deliberately manual after a successful ownership handoff.
**Do not use Pi's `/worktrees` retirement on OpenCode assessment worktrees:** its
agent checks currently see only Pi. Use the additive mixed-agent manager below.

`--repo` defaults to the current directory. When `--base` is omitted, the CLI
fetches **origin's live default-branch tip** before creating anything and passes
that immutable commit SHA to Herdr. It does not trust local `origin/HEAD`,
`origin/main`, `main`, or `HEAD`. Missing/unreachable origin or an invalid remote
HEAD stops creation; there is no stale-local fallback. An existing destination
branch is rejected in this mode rather than silently reusing its old history.

The fetch uses a unique temporary ref, removed afterward, so concurrent fetches
cannot overwrite its base through shared `FETCH_HEAD`. It leaves local branches
and remote-tracking refs alone and works with renamed defaults and narrow fetch
refspecs. Freshness means the tip observed by that successful fetch; later remote
commits do not change the pinned creation base.

Use `--base <branch|tag|commit|revision>` only for an intentional base override.
Explicit bases are validated locally and used **without fetching**, preserving
historical or offline choices. Naming the destination with `--branch` does not
opt out of freshness. In Pi, describe the alternate starting point in the task;
the agent supplies `base` only for that request (or a workflow's freshly verified
immutable SHA), never as a workaround for a failed fetch.

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

Before calling the CLI, `create_worktree` preflights the source app's Vercel
identity through `provision-env --check-vercel-link --non-interactive`. When a
link is missing, the tool returns the app directory and retry arguments to the
current Pi agent **before allocating anything**. The agent investigates and links
an unambiguous existing project/team proactively, then retries the same tool
request. Only uncertain selection or missing authentication/access needs user
input. Remote project discovery is agent-owned, not hard-coded in provisioning;
no new Vercel project or deployment is created during linking.

`implement-issue` uses the same tool and hands the destination Pi to the internal
`implement-issue-worktree` continuation skill, so issue-driven and local creation
have the same session lifecycle.

## Worktree manager

In Pi's interactive TUI, `/worktrees` opens a repository-scoped dashboard that
joins Git checkout state with Herdr workspaces, Pi agents, Vercel environment
health, and the `default`/`test` sandbox database leases. It inspects env-file
existence, ignore status, and permissions without reading or displaying values.

Keybindings:

```text
↑↓/jk  select                     Enter  focus workspace
 a     create through the handoff  o      open/focus in Herdr
 p     start or focus Pi            m      prompt a selected Pi
 n     renew both database leases   v      provision missing environment
 f     fetch and prune origin       d      coordinated retirement
 c     load path into Pi's editor   r      refresh
 q/Esc close
```

Starting or focusing Pi closes the manager after Herdr focuses the destination.
When multiple Pi agents share a workspace, the manager asks which pane to target.
Provisioning delegates to `provision-env` in non-interactive, fail-closed mode.

Retirement refuses the current or primary checkout, dirty Git state, and
working, blocked, or unknown Pi agents. It rechecks Git status and both database
lease slots, then runs `sandbox-db release` for each managed lease before Herdr
removes the checkout. Each release deletes the provisioned Neon branch, removes
its leased database URL keys, and removes the local lease record. Cleanup fails
closed if a lease cannot be safely released. Retirement may optionally run safe
`git branch -d`; it never force-removes a checkout or branch.
Because database release and Herdr removal cannot be atomic, a failure reports
all irreversible steps that completed so recovery remains explicit.

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

1. resolves the source Git checkout, requires a new destination branch and fetches/pins origin's current default tip unless `--base` is explicit, then resolves the sibling checkout path;
2. calls `herdr worktree create --path ...`, which creates both the checkout and its grouped Herdr workspace;
3. resolves the workspace's initial root pane;
4. runs `provision-env --database --non-interactive`, failing safely on unexpected existing env files, pulling Development and `test` Vercel variables, removing deployment-only metadata and integration database URLs, and creating independent database leases for both;
5. runs every explicit `--setup` command;
6. starts a fresh selected agent (Pi by default) without a task attached;
7. verifies the agent's kind, alias, destination pane, and explicit interactive readiness;
8. submits the kickoff task as the fresh session's first prompt;
9. focuses the destination workspace.

The CLI never moves or forks the caller's Pi session. A Pi adapter may shut down
the caller only after this command succeeds, leaving one active Pi in the new
worktree.

## Failure and recovery

`provision-env` owns rollback of newly pulled `.env.local` and `.env.test` files
and database leases created by that invocation. After Herdr has created the checkout, this CLI preserves the
worktree, branch, and workspace on later failure so the exact state can be
inspected and resumed. It never force-removes a checkout or deletes a branch.

The CLI verifies the selected harness is interactive before submitting the kickoff
through `agent prompt`, avoiding lost terminal input and false launch timeouts
when the agent immediately enters a working state. Only Herdr's structured
startup-timeout error is recoverable, and only after a single pane lookup confirms
the matching kind, exact pane, `interactive_ready: true`, no pending launch, and
an idle or working status. Normal startup also verifies the named alias. Missing
kind/readiness evidence fails closed, including for Pi; older Herdr responses
that only report an idle/working status are no longer enough to recover a timeout.
Blocked startup—such as Pi's trust selector—never receives kickoff terminal input.
There are no launch or prompt retries. A failed prompt acknowledgement can mean the
task was accepted: inspect the preserved destination rather than resubmitting
blindly. A later workspace-focus failure is reported as a warning while the
command still exits successfully, allowing Pi adapters to shut down the source
instead of leaving two active sessions.

## Development

```sh
cd ~/.dotfiles/home/scripts/.local/share/worktree
bun install
bun test
bun run typecheck
```

## Mixed-agent management (additive)

`worktree-manage` is a headless, JSON-only manager for **both Pi and OpenCode**:

```sh
worktree-manage list --cwd /canonical/source
worktree-manage plan --cwd /canonical/source --path /canonical/target --workspace WORKSPACE_ID
worktree-manage renew --cwd /canonical/source --path /canonical/target --workspace WORKSPACE_ID --ttl 7d
worktree-manage retire --cwd /canonical/source --path /canonical/target --workspace WORKSPACE_ID --confirm /canonical/target --expect-plan TOKEN_FROM_PLAN
```

Retirement keeps the Git branch by default. Optional `--delete-branch` uses only
`git branch -d`; squash-merged/unmerged branches are retained and reported, never
forced. Required `--expect-plan` pins the confirmed repository, branch, HEAD and
lease IDs. Optional `--expect-releases test,default` additionally checks lease names
(`--expect-releases ''` for none). Run inside the intended Herdr pane; no implicit
current-directory target. Protected/default leases are refused before any release.

The existing **Pi dashboard cannot see OpenCode agents**. Use this manager (or
OpenCode `/worktrees`) for mixed assessment worktrees. Pi defaults/files unchanged.

Inventory uses explicit Herdr `worktree list --cwd`, workspace/agent lists, Git
status, and sandbox-db lease records. It never reads environment files or prints
raw command responses/errors. Unknown identities/statuses fail closed. Retirement
requires the canonical exact linked checkout and workspace; primary, detached,
prunable, current/subdirectory, dirty, unavailable and active/blocked/unknown-agent
targets are refused. All agent kinds are considered. Both default/test plus any
extra recorded leases are checked before deletion; live/missing leases are released
through sandbox-db before Herdr removes the workspace and checkout. Full checks
repeat before each release and immediately before removal. Commands have bounded
60-second deadlines; cancellation waits for descendant SIGKILL cleanup.

Mutation journals live in `~/.local/state/worktree-manager`: private directory,
mode-0600 append-only receipts synced **before** irreversible commands. Completed
receipts are archived as `*.complete.jsonl`, permitting later operations. An active
receipt blocks another mutation of that target. On failure/interruption, inspect
its pending/completed steps and independently reconcile Git, Herdr and sandbox-db
state before manually archiving the receipt. **Never blindly retry or delete a
receipt to bypass an unknown outcome.** No automatic rollback or force-reset helper.
Read-only inspection remains available. Prior successful releases cannot be undone.

Checks are snapshots, not cross-system locks: an external actor can change agent,
Git, workspace or lease state in the final command gap. Avoid concurrent changes
to a retirement target. Idle/done agents may be closed by an explicitly confirmed
retirement; the source checkout/workspace remains open. Ignored provisioning files
are not treated as Git dirt. Unknown extra harnesses conservatively block retirement.
