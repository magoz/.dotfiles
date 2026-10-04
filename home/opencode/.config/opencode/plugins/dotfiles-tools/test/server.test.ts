import assert from "node:assert/strict"
import test from "node:test"
import type { SessionCreateInput, SessionPromptInput, WorktreeCreateInput } from "@opencode/client/effect/api"
import type { CommandDefinition } from "@opencode/plugin/effect/command"
import { Project } from "@opencode/schema/project"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { Effect, Exit, Scope } from "effect"
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

function fixture(options: { preflight?: ProcessResult; worktree?: Effect.Effect<{ readonly directory: AbsolutePath }, unknown>; prompt?: Effect.Effect<unknown, unknown> } = {}) {
  const calls: Call[] = []
  const worktrees: WorktreeCreateInput[] = []
  const sessions: SessionCreateInput[] = []
  const prompts: SessionPromptInput[] = []
  const tools = new Map<string, CreateWorktreeTool>()
  const commands = new Map<string, CommandDefinition>()
  const host: Host = {
    location,
    session: {
      get: ({ sessionID }) => Effect.succeed(sessionID === root.id ? root : { ...root, id: sessionID, parentID: root.id }),
      create: (input) => Effect.sync(() => (sessions.push(input), { id: Session.ID.make("ses_new") })),
      prompt: (input) => Effect.suspend(() => (prompts.push(input), input.sessionID === root.id ? Effect.void : (options.prompt ?? Effect.void))),
    },
    worktree: {
      create: (input) => Effect.suspend(() => (worktrees.push(input), options.worktree ?? Effect.succeed({ directory: AbsolutePath.make("/repo-feat-task") }))),
    },
    command: { transform: (edit) => Effect.sync(() => edit({ add: (definition) => void commands.set(definition.name, definition) })) },
    tool: { transform: (edit) => Effect.sync(() => edit({ add: (tool) => void tools.set(tool.name, tool) })) },
  }
  const run = (command: string, args: readonly string[], process: ProcessOptions) =>
    Effect.sync(() => {
      calls.push({ command, args, env: process.env })
      return options.preflight ?? { code: 0, stdout: "", stderr: "" }
    })
  let api: Effect.Success<ReturnType<typeof setup>> | undefined
  const start = async () => {
    const scope = Effect.runSync(Scope.make())
    api = await Effect.runPromise(setup(host, { run, env: { PATH: "/bin", HERDR_ENV: "1", HERDR_SOCKET: "server pane" } }).pipe(Scope.provide(scope)))
    return () => Effect.runPromise(Scope.close(scope, Exit.void))
  }
  /** The registered tool's executor, as the host calls it (failing with the sanitized Tool.Error). */
  const call = (input: WorktreeInput, sessionID = root.id) => {
    assert.ok(api)
    return Effect.runPromise(api.execute(input, { sessionID }))
  }
  return { calls, worktrees, sessions, prompts, tools, commands, start, call }
}

test("registers create_worktree with an exact schema and a /worktree command", async (t) => {
  assert.equal(plugin.id, "dotfiles-tools")
  const f = fixture()
  t.after(await f.start())
  assert.deepEqual([...f.tools.keys()], ["create_worktree"])
  const tool = f.tools.get("create_worktree")
  assert.deepEqual(tool?.options, { codemode: false, permission: "create_worktree" })
  // The host validates tool input with this portable schema: a model-supplied repo is refused.
  const refused = await tool?.input["~standard"].validate({ branch: "feat/task", repo: "/evil" })
  assert.ok(refused && "issues" in refused && refused.issues?.length)
  assert.deepEqual([...f.commands.keys()], ["worktree"])
})

test("no TUI or Herdr needed: preflight, native worktree, fresh session that receives the task", async (t) => {
  const f = fixture()
  t.after(await f.start())
  const result = await f.call({ branch: "feat/task", prompt: "Implement the task\nwith details" })
  assert.deepEqual(f.calls.map((call) => [call.command, ...call.args]), [["provision-env", "--repo", "/repo", "--check-vercel-link", "--non-interactive"]])
  assert.equal(f.calls[0]?.env.HERDR_SOCKET, undefined)
  assert.equal(f.calls[0]?.env.PATH, "/bin")
  assert.deepEqual(f.worktrees, [{ projectID: "prj_repo", name: "feat--task" }])
  assert.deepEqual(f.sessions, [{ location: { directory: "/repo-feat-task" }, title: "Implement the task" }])
  assert.deepEqual(f.prompts, [{ sessionID: "ses_new", text: "Implement the task\nwith details" }])
  assert.deepEqual(result.output, { status: "ready", destination: { directory: "/repo-feat-task", branch: "feat/task", sessionID: "ses_new", prompted: true } })
  assert.ok(typeof result.content === "string" && /destination session owns the task/.test(result.content))
})

test("base becomes the starting ref; an inferred branch and no prompt still work", async (t) => {
  const f = fixture()
  t.after(await f.start())
  await f.call({ branch: "fix/api/retry", base: "abc123" })
  assert.deepEqual(f.worktrees, [{ projectID: "prj_repo", name: "fix--api--retry", branch: "abc123" }])
  assert.deepEqual(f.sessions, [{ location: { directory: "/repo-feat-task" }, title: "fix/api/retry" }])
  assert.deepEqual(f.prompts, [])
  await f.call({ prompt: "Add CSV export" })
  assert.equal(f.worktrees[1]?.name, "feat--csv-export")
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
})

test("fails closed before allocating: child session, unknown preflight failure, unencodable branch", async (t) => {
  const f = fixture({ preflight: { code: 1, stdout: "", stderr: "secret token" } })
  t.after(await f.start())
  await assert.rejects(f.call({ branch: "feat/task" }, "ses_child"), /root session/)
  await assert.rejects(f.call({ branch: "feat/task" }), (error: Error) => /nothing allocated/.test(error.message) && !error.message.includes("secret"))
  await assert.rejects(f.call({ branch: "feat--x" }), /no exact worktree name/)
  assert.deepEqual(f.worktrees, [])
})

test("failures after allocation say what was kept", async (t) => {
  const failed = fixture({ worktree: Effect.fail(new Error("worktree checkout refused feat/task before allocating anything\nstack")) })
  t.after(await failed.start())
  await assert.rejects(failed.call({ branch: "feat/task" }), (error: Error) => error.message === "Creating the worktree failed: worktree checkout refused feat/task before allocating anything")
  assert.deepEqual(failed.sessions, [])

  const unsent = fixture({ prompt: Effect.fail(new Error("busy")) })
  t.after(await unsent.start())
  await assert.rejects(unsent.call({ branch: "feat/task", prompt: "task" }), /Worktree kept at \/repo-feat-task; session ses_new created without the task/)
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
