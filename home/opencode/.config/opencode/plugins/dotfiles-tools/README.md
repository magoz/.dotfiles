# dotfiles-tools — `create_worktree` and `/worktree`

**Effect server** plugin (shared deps in `../package.json`). It has no TUI half and does not use
Herdr. It works the same from the web app, Fleet and the TUI.

| File | Role |
| --- | --- |
| `server.ts` | `create_worktree` tool, `/worktree` command, source-session checks, preflight |
| `contract.ts` | Effect Schemas: tool input/output, `provision-env` link report |
| `worktree.ts` | branch inference, agent guidance |

## Flow

`create_worktree` takes `{ branch?, base?, prompt? }`. If `branch` is missing, it is inferred
from `prompt`. Repo/cwd are **not model parameters**: the server resolves them from the calling
session's location and subpath, rejects escapes and cross-location sessions, and accepts root
sessions only. Host schemas are `portable(..., { exact: true })`, so unknown keys (such as
`repo`, or the Herdr-era `setup`/`ttl`/`path`/`label`) are rejected.

1. `provision-env --repo <cwd> --check-vercel-link --non-interactive` (30s), run with the
   service's environment minus `HERDR_*`. Nothing has been allocated at this point. Only exit 3
   with a strict `{status:'vercel_link_required',directory,reason}` report becomes a structured
   result containing the identical `retry` input. Any other failure stops the call, and
   stderr is never echoed.
2. `ctx.worktree.create({ projectID, name, branch: base })`: OpenCode's native worktree API,
   which goes through the dotfiles `worktrees` strategy. That creates a provisioned sibling
   checkout and an ownership marker, and the checkout can be retired from OpenCode and Fleet.
   `name` is `branchToName(branch)` (`feat/x` → `feat--x`). Branches without an exact encoding
   are refused before anything is allocated.
3. `ctx.session.create({ location: { directory } })`, then `ctx.session.prompt` with `prompt`.

This is the same sequence as Fleet's launcher (`worktree.create` → `session.create` →
`session.prompt`), so the new session shows up in Fleet like any launch. When a step after
step 2 fails, the error says what was kept (the worktree, or the session without its task).
Nothing is rolled back and nothing is retried automatically.

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
