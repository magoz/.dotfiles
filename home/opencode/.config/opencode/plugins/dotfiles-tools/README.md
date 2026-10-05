# dotfiles-tools — `create_worktree` and `/worktree`

**Effect server** plugin (shared deps in `../package.json`). It has no TUI half and does not use
Herdr. It works the same from the web app, Fleet and the TUI.

| File | Role |
| --- | --- |
| `server.ts` | `create_worktree` tool, `/worktree` command, source-session checks, preflight |
| `contract.ts` | Effect Schemas: tool input/output, `provision-env` link report |
| `worktree.ts` | branch inference, agent guidance |

## Flow

`create_worktree` takes `{ repo?, branch?, base?, prompt? }`. If `branch` is missing, it is
inferred from `prompt`. `repo` (absolute) picks another repository, so a session in one repo
can start work in another. It defaults to the calling session's directory, which the server
resolves from its location and subpath (escapes and cross-location sessions are rejected).
Either way, the target is `git rev-parse --show-toplevel` of that directory. Only root
sessions can call the tool. Host schemas are `portable(..., { exact: true })`, so unknown keys
(such as the Herdr-era `setup`/`ttl`/`path`/`label`) are rejected.

1. `provision-env --repo <repo> --check-vercel-link --non-interactive` (30s), run with the
   service's environment minus `HERDR_*`. Nothing has been allocated at this point. Only exit 3
   with a strict `{status:'vercel_link_required',directory,reason}` report becomes a structured
   result containing the identical `retry` input. Any other failure stops the call, and
   stderr is never echoed.
2. `ctx.session.create({ location: { directory: repo } })`: the destination session. Plugins
   have no project lookup, and creating a session is how `repo`'s project gets resolved.
3. `ctx.worktree.create({ projectID, name, branch: base })`: OpenCode's native worktree API,
   which goes through the dotfiles `worktrees` strategy. That creates a provisioned sibling
   checkout and an ownership marker, and the checkout can be retired from OpenCode and Fleet.
   `name` is `branchToName(branch)` (`feat/x` → `feat--x`). Branches without an exact encoding
   are refused before anything is allocated.
   OpenCode runs the target project's own strategy, so this works across repositories.
4. `ctx.session.move` into the worktree, then `ctx.session.prompt` with `prompt`. The move is
   queued before the task, so the task runs in the worktree.

Apart from the session being created first and then moved, this matches Fleet's launcher
(`worktree.create` → `session.create` → `session.prompt`), so the new session shows up in Fleet
like any launch.

If a later step fails, or the tool call is interrupted, everything allocated after the
preflight is rolled back so an identical retry works: a created worktree is retired through
the strategy (`worktree-manage`, never forced) and the destination session is deleted. If the
worktree creation itself fails, the strategy may keep a partially provisioned checkout on
purpose, and its message says where. The error names anything the rollback could not remove.
Nothing is retried automatically.

There is no confirmation prompt. Consent is the user's explicit request: the tool description
says to use it only when the user asks, and `/worktree` is a user action. Child agents
cannot call it (`tests/config.test.mjs`), and a `create_worktree: deny` permission rule
removes it.

The source session stays open. The destination session owns the task.

## `/worktree [task]`

A server command, so it works in every client. It queues a user prompt in the current session
asking the agent to call `create_worktree` for the task, choosing a conventional branch. It
never calls the tool itself.

## Why not the old pane handoff

Before this change, the TUI claimed a request over plugin RPC, confirmed it in a dialog and ran
`worktree create --agent opencode` in its own Herdr pane. That needed exactly one live TUI on
the root session, so sessions driven from the web app or Fleet always failed ("Exactly one live
TUI on the root session is required"). Herdr worktrees remain available through
`worktree create` and Pi.

## Validation

```sh
npm test --prefix home/opencode/.config/opencode   # typecheck + all plugin tests
npm run test:native --prefix home/opencode/.config/opencode   # `/worktree` registered on a real server
```

The tests use a fake host and a fake preflight runner. No real worktrees, sessions or
processes are created.
