import assert from "node:assert/strict"
import test from "node:test"
import type { SessionCreateInput, SessionMoveInput, SessionPromptInput, WorktreeCreateInput, WorktreeRemoveInput } from "@opencode/client/effect/api"
import type { CommandDefinition } from "@opencode/plugin/effect/command"
import { Project } from "@opencode/schema/project"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { Effect, Exit, Fiber, Scope } from "effect"
import type { ProcessOptions, ProcessResult } from "../../shared/process.ts"
import type { WorktreeInput } from "../contract.ts"
import plugin, { setup, type CreateWorktreeTool, type Host } from "../server.ts"

const location = { directory: "/repo" }
const root = { id: "ses_root", projectID: Project.ID.make("prj_repo"), location }
const linkReport = JSON.stringify({ status: "vercel_link_required", directory: "/repo", reason: "missing" })

interface Call {
  readonly command: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

interface FixtureOptions {
  readonly preflight?: ProcessResult
  readonly worktree?: Effect.Effect<{ readonly directory: AbsolutePath }, unknown>
  readonly move?: Effect.Effect<unknown, unknown>
  readonly prompt?: Effect.Effect<unknown, unknown>
  readonly removeSession?: Effect.Effect<unknown, unknown>
  readonly removeWorktree?: Effect.Effect<unknown, unknown>
}

function fixture(options: FixtureOptions = {}) {
  const calls: Call[] = []
  const worktrees: WorktreeCreateInput[] = []
  const sessions: SessionCreateInput[] = []
  const moves: SessionMoveInput[] = []
  const removedSessions: string[] = []
  const retired: WorktreeRemoveInput[] = []
  const prompts: SessionPromptInput[] = []
  const tools = new Map<string, CreateWorktreeTool>()
  const commands = new Map<string, CommandDefinition>()
  const host: Host = {
    location,
    session: {
      get: ({ sessionID }) => Effect.succeed(sessionID === root.id ? root : { ...root, id: sessionID, parentID: root.id }),
      // OpenCode resolves the project of the directory a session is created in.
      create: (input) =>
        Effect.sync(() => (sessions.push(input), { id: Session.ID.make("ses_new"), projectID: Project.ID.make(input.location?.directory === "/other" ? "prj_other" : "prj_repo") })),
      remove: ({ sessionID }) => Effect.suspend(() => (removedSessions.push(sessionID), options.removeSession ?? Effect.void)),
      move: (input) => Effect.suspend(() => (moves.push(input), options.move ?? Effect.void)),
      prompt: (input) => Effect.suspend(() => (prompts.push(input), input.sessionID === root.id ? Effect.void : (options.prompt ?? Effect.void))),
    },
    worktree: {
      create: (input) => Effect.suspend(() => (worktrees.push(input), options.worktree ?? Effect.succeed({ directory: AbsolutePath.make("/repo-feat-task") }))),
      remove: (input) => Effect.suspend(() => (retired.push(input), options.removeWorktree ?? Effect.void)),
    },
    command: { transform: (edit) => Effect.sync(() => edit({ add: (definition) => void commands.set(definition.name, definition) })) },
    tool: { transform: (edit) => Effect.sync(() => edit({ add: (tool) => void tools.set(tool.name, tool) })) },
  }
  // `git rev-parse --show-toplevel` succeeds for /repo (and its subdirectories) and /other.
  const run = (command: string, args: readonly string[], process: ProcessOptions) =>
    Effect.sync((): ProcessResult => {
      calls.push({ command, args, env: process.env })
      if (command !== "git") return options.preflight ?? { code: 0, stdout: "", stderr: "" }
      const top = ["/repo", "/other"].find((repo) => args[1] === repo || args[1]?.startsWith(`${repo}/`))
      return top ? { code: 0, stdout: `${top}\n`, stderr: "" } : { code: 128, stdout: "", stderr: "not a git repository" }
    })
  let api: Effect.Success<ReturnType<typeof setup>> | undefined
  const start = async () => {
    const scope = Effect.runSync(Scope.make())
    api = await Effect.runPromise(setup(host, { run, env: { PATH: "/bin", HERDR_ENV: "1", HERDR_SOCKET: "server pane" } }).pipe(Scope.provide(scope)))
    return () => Effect.runPromise(Scope.close(scope, Exit.void))
  }
  /** The registered tool's executor, as the host calls it (failing with the sanitized Tool.Error). */
  const execute = (input: WorktreeInput, sessionID = root.id) => {
    assert.ok(api)
    return api.execute(input, { sessionID })
  }
  const call = (input: WorktreeInput, sessionID = root.id) => Effect.runPromise(execute(input, sessionID))
  return { calls, worktrees, sessions, moves, prompts, removedSessions, retired, tools, commands, start, execute, call }
}

test("registers create_worktree with an exact schema and a /worktree command", async (t) => {
  assert.equal(plugin.id, "dotfiles-tools")
  const f = fixture()
  t.after(await f.start())
  assert.deepEqual([...f.tools.keys()], ["create_worktree"])
  const tool = f.tools.get("create_worktree")
  assert.deepEqual(tool?.options, { codemode: false, permission: "create_worktree" })
  // The host validates tool input with this exact portable schema: Herdr-era fields are refused.
  const refused = await tool?.input["~standard"].validate({ branch: "feat/task", setup: ["npm ci"] })
  assert.ok(refused && "issues" in refused && refused.issues?.length)
  assert.deepEqual([...f.commands.keys()], ["worktree"])
})

test("no TUI or Herdr needed: preflight, native worktree, fresh session moved there that receives the task", async (t) => {
  const f = fixture()
  t.after(await f.start())
  const result = await f.call({ branch: "feat/task", prompt: "Implement the task\nwith details" })
  assert.deepEqual(f.calls.map((call) => [call.command, ...call.args]), [
    ["git", "-C", "/repo", "rev-parse", "--show-toplevel"],
    ["provision-env", "--repo", "/repo", "--check-vercel-link", "--non-interactive"],
  ])
  for (const call of f.calls) assert.deepEqual(call.env, { PATH: "/bin" })
  assert.deepEqual(f.sessions, [{ location: { directory: "/repo" }, title: "Implement the task" }])
  assert.deepEqual(f.worktrees, [{ projectID: "prj_repo", name: "feat--task" }])
  assert.deepEqual(f.moves, [{ sessionID: "ses_new", directory: "/repo-feat-task" }])
  assert.deepEqual(f.prompts, [{ sessionID: "ses_new", text: "Implement the task\nwith details" }])
  assert.deepEqual(result.output, { status: "ready", destination: { directory: "/repo-feat-task", branch: "feat/task", sessionID: "ses_new", prompted: true } })
  assert.ok(typeof result.content === "string" && /destination session owns the task/.test(result.content))
})

test("base becomes the starting ref; an inferred branch and no prompt still work", async (t) => {
  const f = fixture()
  t.after(await f.start())
  await f.call({ branch: "fix/api/retry", base: "abc123" })
  assert.deepEqual(f.worktrees, [{ projectID: "prj_repo", name: "fix--api--retry", branch: "abc123" }])
  assert.deepEqual(f.sessions, [{ location: { directory: "/repo" }, title: "fix/api/retry" }])
  assert.deepEqual(f.prompts, [])
  await f.call({ prompt: "Add CSV export" })
  assert.equal(f.worktrees[1]?.name, "feat--csv-export")
})

test("repo targets another repository's project from this session", async (t) => {
  const f = fixture()
  t.after(await f.start())
  await f.call({ repo: "/other/packages/x", branch: "feat/task", prompt: "task" })
  assert.deepEqual(f.calls.map((call) => call.args[1]), ["/other/packages/x", "/other"])
  assert.deepEqual(f.sessions, [{ location: { directory: "/other" }, title: "task" }])
  assert.deepEqual(f.worktrees, [{ projectID: "prj_other", name: "feat--task" }])
  await assert.rejects(f.call({ repo: "/nowhere", branch: "feat/task" }), /Not a Git checkout: \/nowhere/)
  await assert.rejects(f.call({ repo: "relative", branch: "feat/task" }), /absolute path/)
  // Still root-only, whatever the target.
  await assert.rejects(f.call({ repo: "/other", branch: "feat/task" }, "ses_child"), /root session/)
  assert.equal(f.worktrees.length, 1)
})

test("vercel link required: structured retry, nothing allocated", async (t) => {
  const f = fixture({ preflight: { code: 3, stdout: "", stderr: linkReport } })
  t.after(await f.start())
  const result = await f.call({ branch: "feat/task", prompt: "task" })
  assert.deepEqual(result.output, {
    status: "vercel_link_required",
    link: { status: "vercel_link_required", directory: "/repo", reason: "missing" },
    retry: { branch: "feat/task", prompt: "task" },
  })
  assert.deepEqual(f.worktrees, [])
  assert.deepEqual(f.sessions, [])
})

test("fails closed before allocating: child session, unknown preflight failure, unencodable branch", async (t) => {
  const f = fixture({ preflight: { code: 1, stdout: "", stderr: "secret token" } })
  t.after(await f.start())
  await assert.rejects(f.call({ branch: "feat/task" }, "ses_child"), /root session/)
  await assert.rejects(f.call({ branch: "feat/task" }), (error: Error) => /nothing allocated/.test(error.message) && !error.message.includes("secret"))
  await assert.rejects(f.call({ branch: "feat--x" }), /no exact worktree name/)
  assert.deepEqual(f.worktrees, [])
})

test("a failed worktree deletes the destination session; the strategy reports any kept checkout", async (t) => {
  const f = fixture({ worktree: Effect.fail(new Error("provision failed; preserved checkout /repo-feat-task on branch feat/task\nstack")) })
  t.after(await f.start())
  await assert.rejects(
    f.call({ branch: "feat/task", prompt: "task" }),
    (error: Error) =>
      error.message === "Creating the worktree failed: provision failed; preserved checkout /repo-feat-task on branch feat/task. Rolled back: nothing left behind",
  )
  assert.deepEqual(f.removedSessions, ["ses_new"])
  assert.deepEqual(f.retired, [])
  assert.deepEqual(f.moves, [])
})

test("a failure after the worktree exists retires it and deletes the session, so a retry works", async (t) => {
  for (const [options, message] of [
    [{ move: Effect.fail(new Error("busy")) }, "Moving the destination session failed: busy"],
    [{ prompt: Effect.fail(new Error("busy")) }, "Sending the task failed: busy"],
  ] as const) {
    const f = fixture(options)
    t.after(await f.start())
    await assert.rejects(f.call({ branch: "feat/task", prompt: "task" }), (error: Error) => error.message === `${message}. Rolled back: nothing left behind`)
    assert.deepEqual(f.retired, [{ projectID: "prj_repo", directory: "/repo-feat-task", force: false }])
    assert.deepEqual(f.removedSessions, ["ses_new"])
  }
})

test("an incomplete rollback names what is left", async (t) => {
  const f = fixture({ prompt: Effect.fail(new Error("busy")), removeWorktree: Effect.fail(new Error("dirty")), removeSession: Effect.fail(new Error("gone")) })
  t.after(await f.start())
  await assert.rejects(
    f.call({ branch: "feat/task", prompt: "task" }),
    /Sending the task failed: busy\. Rollback incomplete; still exists: worktree \/repo-feat-task \(retire it with worktree-manage plan-checkout\/retire-checkout\), session ses_new$/,
  )
})

test("interrupting the call rolls back too", async (t) => {
  const f = fixture({ prompt: Effect.never })
  t.after(await f.start())
  const fiber = Effect.runFork(f.execute({ branch: "feat/task", prompt: "task" }))
  for (let i = 0; i < 50 && f.prompts.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(f.prompts.length, 1)
  await Effect.runPromise(Fiber.interrupt(fiber))
  assert.deepEqual(f.retired, [{ projectID: "prj_repo", directory: "/repo-feat-task", force: false }])
  assert.deepEqual(f.removedSessions, ["ses_new"])
})

test("/worktree asks the agent in the same session, never calls the tool itself", async (t) => {
  const f = fixture()
  t.after(await f.start())
  const command = f.commands.get("worktree")
  assert.ok(command)
  await Effect.runPromise(command.execute({ sessionID: Session.ID.make(root.id), prompt: { text: "  Add CSV export " }, delivery: "queue" }))
  assert.equal(f.prompts.length, 1)
  assert.equal(f.prompts[0]?.sessionID, root.id)
  assert.equal(f.prompts[0]?.delivery, "queue")
  assert.match(f.prompts[0]?.text ?? "", /Use create_worktree[\s\S]*Task: Add CSV export$/)
  assert.deepEqual(f.worktrees, [])
})
