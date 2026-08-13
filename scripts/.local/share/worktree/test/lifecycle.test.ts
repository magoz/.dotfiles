import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ProcessError } from "../src/domain"
import { branchPathSlug, defaultWorktreePath } from "../src/git"
import { createEnvironment } from "../src/lifecycle"
import { agentNameFor, buildCreateArgs } from "../src/herdr"
import { Process, type ProcessService } from "../src/process"

interface Call {
  readonly mode: "capture" | "inherit"
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
}

const createFake = (options: { failProvision?: boolean; failFocus?: boolean } = {}) => {
  const calls: Array<Call> = []
  const capture: ProcessService["capture"] = (command, args, runOptions = {}) => {
    calls.push({ mode: "capture", command, args, cwd: runOptions.cwd })

    if (command === "git" && args.includes("--show-toplevel")) {
      return Effect.succeed({ stdout: "/repo\n", stderr: "" })
    }
    if (command === "git" && args.includes("--verify")) {
      return Effect.succeed({ stdout: "abc123\n", stderr: "" })
    }
    if (command === "git" && args.includes("--git-common-dir")) {
      return Effect.succeed({ stdout: "/repo/.git\n", stderr: "" })
    }
    if (command === "herdr" && args[0] === "worktree") {
      return Effect.succeed({
        stdout: JSON.stringify({
          id: "cli:worktree:create",
          result: {
            type: "worktree_created",
            workspace: { workspace_id: "wA" },
            worktree: { path: "/worktrees/repo/feature", branch: "feat/feature" }
          }
        }),
        stderr: ""
      })
    }
    if (command === "herdr" && args[0] === "pane" && args[1] === "list") {
      return Effect.succeed({
        stdout: JSON.stringify({
          id: "cli:pane:list",
          result: {
            type: "pane_list",
            panes: [{ pane_id: "wA:p1", workspace_id: "wA", tab_id: "wA:t1" }]
          }
        }),
        stderr: ""
      })
    }
    if (command === "herdr" && args[0] === "agent" && args[1] === "start") {
      return Effect.succeed({
        stdout: JSON.stringify({
          result: {
            type: "agent_started",
            agent: { pane_id: "wA:p1", workspace_id: "wA", name: "wt-feat-feature-wa" }
          }
        }),
        stderr: ""
      })
    }
    if (command === "herdr" && args[0] === "agent" && args[1] === "get") {
      return Effect.succeed({
        stdout: JSON.stringify({
          result: {
            type: "agent_info",
            agent: {
              pane_id: "wA:p1",
              workspace_id: "wA",
              name: "wt-feat-feature-wa",
              interactive_ready: true,
              launch_pending: false
            }
          }
        }),
        stderr: ""
      })
    }
    if (command === "herdr" && args[0] === "workspace" && args[1] === "focus") {
      if (options.failFocus) {
        return Effect.fail(
          new ProcessError({
            command: "herdr workspace focus",
            exitCode: 1,
            stdout: "",
            stderr: "focus failed"
          })
        )
      }
      return Effect.succeed({ stdout: "{}\n", stderr: "" })
    }
    return Effect.succeed({ stdout: "{}\n", stderr: "" })
  }

  const inherit: ProcessService["inherit"] = (command, args, runOptions = {}) => {
    calls.push({ mode: "inherit", command, args, cwd: runOptions.cwd })
    if (options.failProvision && command === "provision-env") {
      return Effect.fail(
        new ProcessError({
          command: "provision-env",
          exitCode: 2,
          stdout: "",
          stderr: "install failed"
        })
      )
    }
    return Effect.void
  }

  return {
    calls,
    layer: Layer.succeed(Process, { capture, inherit })
  }
}

test("buildCreateArgs keeps values as argv and does not invoke a shell", () => {
  expect(
    buildCreateArgs("/repo with spaces", "origin/main", {
      repo: "/repo with spaces",
      branch: "feat/reporting",
      base: "origin/main",
      path: "/tmp/tree with spaces",
      label: "reporting",
      ttl: "7d",
      setupCommands: []
    })
  ).toEqual([
    "worktree",
    "create",
    "--cwd",
    "/repo with spaces",
    "--branch",
    "feat/reporting",
    "--base",
    "origin/main",
    "--path",
    "/tmp/tree with spaces",
    "--label",
    "reporting",
    "--no-focus"
  ])
})

test("default checkout paths are siblings of the primary repository", async () => {
  const fake = createFake()
  expect(branchPathSlug("Feature/Discussion Issue #212")).toBe("feature-discussion-issue-212")
  await expect(
    Effect.runPromise(
      defaultWorktreePath("/repo", "discussion/issue-212").pipe(Effect.provide(fake.layer))
    )
  ).resolves.toBe("/repo-discussion-issue-212")
  await expect(
    Effect.runPromise(
      defaultWorktreePath("/repo-existing-worktree", "fix/other").pipe(Effect.provide(fake.layer))
    )
  ).resolves.toBe("/repo-fix-other")
})

test("agent names are valid, deterministic, and bounded", () => {
  const name = agentNameFor("Feature/A Very Long Branch Name With Symbols!", "wABC123")
  expect(name).toMatch(/^[a-z][a-z0-9-]{0,31}$/)
  expect(name.length).toBeLessThanOrEqual(32)
  expect(name).toBe(agentNameFor("Feature/A Very Long Branch Name With Symbols!", "wABC123"))
})

test("the lifecycle provisions before setup and starts one fresh Pi", async () => {
  const fake = createFake()
  const created = await Effect.runPromise(
    createEnvironment({
      repo: "/repo",
      branch: "feat/feature",
      base: "origin/main",
      label: "feature",
      ttl: "3d",
      prompt: "Implement the feature",
      setupCommands: ["pnpm db:push"]
    }).pipe(Effect.provide(fake.layer))
  )

  expect(created.path).toBe("/worktrees/repo/feature")
  expect(created.workspaceId).toBe("wA")
  expect(created.paneId).toBe("wA:p1")

  const shell = process.env.SHELL || "/bin/sh"
  const createCall = fake.calls.find(
    (call) => call.command === "herdr" && call.args[0] === "worktree" && call.args[1] === "create"
  )
  expect(createCall?.args).toContain("/repo-feat-feature")

  const meaningful = fake.calls.filter(
    (call) => call.command === "provision-env" || call.command === shell || call.command === "herdr"
  )
  expect(meaningful.map((call) => [call.mode, call.command, call.args[0], call.args[1]])).toEqual([
    ["capture", "herdr", "worktree", "create"],
    ["capture", "herdr", "pane", "list"],
    ["inherit", "provision-env", "--repo", "/worktrees/repo/feature"],
    ["inherit", shell, "-lc", "pnpm db:push"],
    ["capture", "herdr", "agent", "start"],
    ["capture", "herdr", "agent", "get"],
    ["capture", "herdr", "workspace", "focus"]
  ])

  const start = fake.calls.find(
    (call) => call.command === "herdr" && call.args[0] === "agent" && call.args[1] === "start"
  )
  expect(start?.args).toContain("pi")
  expect(start?.args).toContain("--name")
  expect(start?.args.at(-1)).toBe("Implement the feature")
})

test("a focus failure is a warning after the destination Pi is ready", async () => {
  const fake = createFake({ failFocus: true })
  const created = await Effect.runPromise(
    createEnvironment({
      repo: "/repo",
      branch: "feat/feature",
      base: "origin/main",
      ttl: "7d",
      prompt: "Implement the feature",
      setupCommands: []
    }).pipe(Effect.provide(fake.layer))
  )

  expect(created.warnings).toHaveLength(1)
  expect(created.warnings[0]).toContain("destination workspace was not focused")
})

test("a provisioning failure preserves the created destination and never starts Pi", async () => {
  const fake = createFake({ failProvision: true })

  await expect(
    Effect.runPromise(
      createEnvironment({
        repo: "/repo",
        branch: "feat/feature",
        base: "origin/main",
        ttl: "7d",
        setupCommands: []
      }).pipe(Effect.provide(fake.layer))
    )
  ).rejects.toThrow("preserved worktree /worktrees/repo/feature and Herdr workspace wA")

  expect(
    fake.calls.some(
      (call) => call.command === "herdr" && call.args[0] === "agent" && call.args[1] === "start"
    )
  ).toBe(false)
})
