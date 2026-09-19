import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ProcessError, type AgentKind } from "../src/domain"
import { branchPathSlug, defaultWorktreePath } from "../src/git"
import { createEnvironment } from "../src/lifecycle"
import { agentNameFor, buildCreateArgs, startPi } from "../src/herdr"
import { Process, type ProcessService } from "../src/process"

interface Call {
  readonly mode: "capture" | "inherit"
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
}

const createFake = (
  options: {
    failFetch?: boolean
    existingBranch?: boolean
    failProvision?: boolean
    failFocus?: boolean
    failSetup?: boolean
    failPrompt?: boolean
    kind?: string | null
    ready?: boolean | null
    launchPending?: boolean
    paneId?: string
    name?: string
    startedPaneId?: string
    startedKind?: string
    toplevel?: string
    commonDir?: string
    startErrorCode?: "cli:agent:start:timeout" | "agent_pane_busy"
    detectedStatus?: "idle" | "working" | "blocked"
  } = {}
) => {
  const calls: Array<Call> = []
  let launchedKind = "pi"
  const capture: ProcessService["capture"] = (command, args, runOptions = {}) => {
    calls.push({ mode: "capture", command, args, cwd: runOptions.cwd })

    if (command === "git" && args.includes("--show-toplevel")) {
      return Effect.succeed({ stdout: `${options.toplevel ?? "/repo"}\n`, stderr: "" })
    }
    if (command === "git" && args.includes("fetch")) {
      if (options.failFetch) return Effect.fail(new ProcessError({
        command: "git fetch", exitCode: 1, stdout: "", stderr: "network unavailable"
      }))
      return Effect.succeed({ stdout: "", stderr: "" })
    }
    if (command === "git" && args.includes("--verify")) {
      if (args.at(-1)?.startsWith("refs/heads/") && !options.existingBranch) {
        return Effect.fail(new ProcessError({
          command: "git rev-parse", exitCode: 1, stdout: "", stderr: "missing branch"
        }))
      }
      return Effect.succeed({ stdout: "abc123\n", stderr: "" })
    }
    if (command === "git" && args.includes("--git-common-dir")) {
      return Effect.succeed({ stdout: `${options.commonDir ?? "/repo/.git"}\n`, stderr: "" })
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
      launchedKind = args[args.indexOf("--kind") + 1]!
      if (options.startErrorCode !== undefined) {
        return Effect.fail(
          new ProcessError({
            command: "herdr agent start",
            exitCode: 1,
            stdout: JSON.stringify({
              error: { code: options.startErrorCode, message: "agent start failed" }
            }),
            stderr: ""
          })
        )
      }
      return Effect.succeed({
        stdout: JSON.stringify({
          result: {
            type: "agent_started",
            agent: {
              pane_id: options.startedPaneId ?? "wA:p1", workspace_id: "wA",
              name: "wt-feat-feature-wa", agent: options.startedKind ?? launchedKind
            }
          }
        }),
        stderr: ""
      })
    }
    if (command === "herdr" && args[0] === "agent" && args[1] === "get") {
      if (options.startErrorCode !== undefined && args[2] !== "wA:p1") {
        return Effect.fail(
          new ProcessError({
            command: "herdr agent get",
            exitCode: 1,
            stdout: "",
            stderr: "agent alias not found"
          })
        )
      }
      if (options.startErrorCode !== undefined) {
        return Effect.succeed({
          stdout: JSON.stringify({
            result: {
              type: "agent_info",
              agent: {
                pane_id: options.paneId ?? "wA:p1",
                workspace_id: "wA",
                agent: options.kind === null ? undefined : options.kind ?? launchedKind,
                interactive_ready: options.ready === null ? undefined : options.ready ?? true,
                launch_pending: options.launchPending ?? false,
                agent_status: options.detectedStatus ?? "working"
              }
            }
          }),
          stderr: ""
        })
      }
      return Effect.succeed({
        stdout: JSON.stringify({
          result: {
            type: "agent_info",
            agent: {
              pane_id: options.paneId ?? "wA:p1",
              workspace_id: "wA",
              name: options.name ?? "wt-feat-feature-wa",
              agent: options.kind === null ? undefined : options.kind ?? launchedKind,
              interactive_ready: options.ready === null ? undefined : options.ready ?? true,
              launch_pending: options.launchPending ?? false
            }
          }
        }),
        stderr: ""
      })
    }
    if (command === "herdr" && args[0] === "agent" && args[1] === "prompt" && options.failPrompt) {
      return Effect.fail(new ProcessError({
        command: "herdr agent prompt", exitCode: 1, stdout: "", stderr: "prompt acknowledgement lost"
      }))
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
    if ((options.failProvision && command === "provision-env") ||
        (options.failSetup && command !== "provision-env")) {
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

test("creation from a linked checkout hands Herdr the primary root", async () => {
  const fake = createFake({ toplevel: "/repo-linked", commonDir: "/repo/.git" })
  const created = await Effect.runPromise(createEnvironment({
    repo: "/repo-linked", branch: "feat/feature", ttl: "7d", setupCommands: []
  }).pipe(Effect.provide(fake.layer)))
  expect(created.source).toBe("/repo-linked")
  const createCall = fake.calls.find(
    (call) => call.command === "herdr" && call.args[0] === "worktree" && call.args[1] === "create"
  )
  expect(createCall?.args[createCall.args.indexOf("--cwd") + 1]).toBe("/repo")
  // Provisioning still copies the app link from the invoking checkout.
  const provisionCall = fake.calls.find((call) => call.command === "provision-env")
  expect(provisionCall?.args).toContain("/repo-linked")
})

test("default creation fetches and pins the base before allocating Herdr resources", async () => {
  const fake = createFake()
  const created = await Effect.runPromise(createEnvironment({
    repo: "/repo", branch: "feat/feature", ttl: "7d", setupCommands: []
  }).pipe(Effect.provide(fake.layer)))
  expect(created.base).toBe("abc123")
  const fetchIndex = fake.calls.findIndex((call) => call.command === "git" && call.args.includes("fetch"))
  const createIndex = fake.calls.findIndex((call) => call.command === "herdr")
  expect(fetchIndex).toBeGreaterThanOrEqual(0)
  expect(createIndex).toBeGreaterThan(fetchIndex)
  expect(fake.calls[createIndex]?.args).toContain("abc123")
})

for (const failure of ["fetch", "existing branch"] as const) {
  test(`${failure} failure allocates no Herdr or provisioning resources`, async () => {
    const fake = createFake({ failFetch: failure === "fetch", existingBranch: failure === "existing branch" })
    await expect(Effect.runPromise(createEnvironment({
      repo: "/repo", branch: "feat/feature", ttl: "7d", setupCommands: []
    }).pipe(Effect.provide(fake.layer)))).rejects.toThrow(
      failure === "fetch" ? "refusing a stale local base" : "branch already exists"
    )
    expect(fake.calls.every((call) => call.command === "git")).toBe(true)
  })
}

test("explicit base creation does not fetch", async () => {
  const fake = createFake({ failFetch: true })
  await Effect.runPromise(createEnvironment({
    repo: "/repo", branch: "feat/feature", base: "release/v1", ttl: "7d", setupCommands: []
  }).pipe(Effect.provide(fake.layer)))
  expect(fake.calls.some((call) => call.args.includes("fetch"))).toBe(false)
  expect(fake.calls.find((call) => call.command === "herdr")?.args).toContain("release/v1")
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
  const provisionCall = fake.calls.find((call) => call.command === "provision-env")
  expect(provisionCall?.args).toContain("--non-interactive")

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
    ["capture", "herdr", "agent", "prompt"],
    ["capture", "herdr", "workspace", "focus"]
  ])

  const start = fake.calls.find(
    (call) => call.command === "herdr" && call.args[0] === "agent" && call.args[1] === "start"
  )
  expect(start?.args).toContain("pi")
  expect(start?.args).toContain("--name")
  expect(start?.args.at(-1)).toBe("feature")
  expect(start?.args).not.toContain("Implement the feature")

  const prompt = fake.calls.find(
    (call) => call.command === "herdr" && call.args[0] === "agent" && call.args[1] === "prompt"
  )
  expect(prompt?.args).toEqual([
    "agent",
    "prompt",
    "wA:p1",
    "Implement the feature"
  ])
})

test("a start timeout is recovered when Pi is detected in the destination pane", async () => {
  const fake = createFake({ startErrorCode: "cli:agent:start:timeout" })
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

  expect(created.paneId).toBe("wA:p1")
  expect(
    fake.calls.some(
      (call) =>
        call.command === "herdr" &&
        call.args[0] === "agent" &&
        call.args[1] === "prompt" &&
        call.args[2] === "wA:p1"
    )
  ).toBe(true)
})

test("non-timeout launch failures are not recovered from pane detection", async () => {
  const fake = createFake({ startErrorCode: "agent_pane_busy" })

  await expect(
    Effect.runPromise(
      createEnvironment({
        repo: "/repo",
        branch: "feat/feature",
        base: "origin/main",
        ttl: "7d",
        prompt: "Implement the feature",
        setupCommands: []
      }).pipe(Effect.provide(fake.layer))
    )
  ).rejects.toThrow("agent start failed")

  expect(
    fake.calls.some(
      (call) =>
        call.command === "herdr" && call.args[0] === "agent" && call.args[1] === "prompt"
    )
  ).toBe(false)
})

test("blocked Pi startup does not receive the kickoff prompt", async () => {
  const fake = createFake({
    startErrorCode: "cli:agent:start:timeout",
    detectedStatus: "blocked"
  })

  await expect(
    Effect.runPromise(
      createEnvironment({
        repo: "/repo",
        branch: "feat/feature",
        base: "origin/main",
        ttl: "7d",
        prompt: "Implement the feature",
        setupCommands: []
      }).pipe(Effect.provide(fake.layer))
    )
  ).rejects.toThrow("agent start failed")

  expect(
    fake.calls.some(
      (call) =>
        call.command === "herdr" && call.args[0] === "agent" && call.args[1] === "prompt"
    )
  ).toBe(false)
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

const lifecycleOptions = {
  repo: "/repo", branch: "feat/feature", base: "origin/main", ttl: "7d",
  label: "feature", prompt: "  Implement the feature  ", setupCommands: ["pnpm db:push"]
}
const agentCalls = (fake: ReturnType<typeof createFake>, action: string) =>
  fake.calls.filter((call) => call.command === "herdr" && call.args[0] === "agent" && call.args[1] === action)

for (const agent of ["pi", "opencode"] as const) {
  test(`${agent} launches exact harness argv and sends the trimmed kickoff exactly once after readiness`, async () => {
    const fake = createFake()
    const created = await Effect.runPromise(createEnvironment({ ...lifecycleOptions, agent }).pipe(Effect.provide(fake.layer)))
    expect(created.agentKind).toBe(agent)
    expect(agentCalls(fake, "start").map((call) => call.args)).toEqual([[
      "agent", "start", "wt-feat-feature-wa", "--kind", agent, "--pane", "wA:p1", "--timeout", "120000",
      ...(agent === "pi" ? ["--", "--name", "feature"] : [])
    ]])
    expect(agentCalls(fake, "prompt").map((call) => call.args)).toEqual([
      ["agent", "prompt", "wA:p1", "Implement the feature"]
    ])
    expect(fake.calls.indexOf(agentCalls(fake, "get")[0]!)).toBeLessThan(fake.calls.indexOf(agentCalls(fake, "prompt")[0]!))
    expect(fake.calls.findIndex((call) => call.command === "provision-env")).toBeLessThan(
      fake.calls.indexOf(agentCalls(fake, "start")[0]!)
    )
  })

  for (const [failure, overrides] of [
    ["wrong kind", { kind: agent === "pi" ? "opencode" : "pi" }],
    ["missing kind", { kind: null }],
    ["missing readiness", { ready: null }],
    ["not interactive", { ready: false }],
    ["pending launch", { launchPending: true }],
    ["wrong pane", { paneId: "other:p1" }]
  ] as const) {
    for (const timeout of [false, true]) {
      test(`${agent} rejects ${failure}${timeout ? " after structured timeout" : ""} without prompting or retrying`, async () => {
        const fake = createFake({ ...overrides, ...(timeout ? { startErrorCode: "cli:agent:start:timeout" as const } : {}) })
        await expect(Effect.runPromise(createEnvironment({ ...lifecycleOptions, agent }).pipe(Effect.provide(fake.layer))))
          .rejects.toThrow("preserved ready worktree")
        expect(agentCalls(fake, "start")).toHaveLength(1)
        expect(agentCalls(fake, "prompt")).toHaveLength(0)
        expect(fake.calls.some((call) => call.args[0] === "workspace" && call.args[1] === "focus")).toBe(false)
      })
    }
  }

  for (const overrides of [{ startedPaneId: "other:p1" }, { startedKind: "other" }, { name: "other" }]) {
    test(`${agent} rejects mismatched launch/alias ${JSON.stringify(overrides)}`, async () => {
      const fake = createFake(overrides)
      await expect(Effect.runPromise(createEnvironment({ ...lifecycleOptions, agent }).pipe(Effect.provide(fake.layer))))
        .rejects.toThrow("startup failed")
      expect(agentCalls(fake, "start")).toHaveLength(1)
      expect(agentCalls(fake, "prompt")).toHaveLength(0)
    })
  }

  for (const detectedStatus of ["idle", "working"] as const) {
    test(`${agent} recovers only a verified ready ${detectedStatus} timeout, without duplicate launch or kickoff`, async () => {
      const fake = createFake({ startErrorCode: "cli:agent:start:timeout", detectedStatus })
      await Effect.runPromise(createEnvironment({ ...lifecycleOptions, agent }).pipe(Effect.provide(fake.layer)))
      expect(agentCalls(fake, "start")).toHaveLength(1)
      expect(agentCalls(fake, "get").map((call) => call.args)).toEqual([["agent", "get", "wA:p1"]])
      expect(agentCalls(fake, "prompt")).toHaveLength(1)
    })
  }

  for (const overrides of [
    { startErrorCode: "agent_pane_busy" as const },
    { startErrorCode: "cli:agent:start:timeout" as const, detectedStatus: "blocked" as const }
  ]) {
    test(`${agent} fails closed without retry or kickoff (${JSON.stringify(overrides)})`, async () => {
      const fake = createFake(overrides)
      await expect(Effect.runPromise(createEnvironment({ ...lifecycleOptions, agent }).pipe(Effect.provide(fake.layer))))
        .rejects.toThrow("agent start failed")
      expect(agentCalls(fake, "start")).toHaveLength(1)
      expect(agentCalls(fake, "prompt")).toHaveLength(0)
      expect(agentCalls(fake, "get")).toHaveLength(overrides.startErrorCode === "agent_pane_busy" ? 0 : 1)
    })
  }

  test(`${agent} never retries a failed prompt acknowledgement`, async () => {
    const fake = createFake({ failPrompt: true })
    await expect(Effect.runPromise(createEnvironment({ ...lifecycleOptions, agent }).pipe(Effect.provide(fake.layer))))
      .rejects.toThrow("prompt acknowledgement lost")
    expect(agentCalls(fake, "start")).toHaveLength(1)
    expect(agentCalls(fake, "prompt")).toHaveLength(1)
  })

  for (const prompt of [undefined, "   "]) {
    test(`${agent} does not send an absent or blank kickoff (${JSON.stringify(prompt)})`, async () => {
      const fake = createFake()
      await Effect.runPromise(createEnvironment({ ...lifecycleOptions, agent, prompt }).pipe(Effect.provide(fake.layer)))
      expect(agentCalls(fake, "start")).toHaveLength(1)
      expect(agentCalls(fake, "prompt")).toHaveLength(0)
    })
  }

  for (const overrides of [{ failProvision: true }, { failSetup: true }]) {
    test(`${agent} preserves provisioning/setup failures without launching (${JSON.stringify(overrides)})`, async () => {
      const fake = createFake(overrides)
      await expect(Effect.runPromise(createEnvironment({ ...lifecycleOptions, agent }).pipe(Effect.provide(fake.layer))))
        .rejects.toThrow("preserved worktree")
      expect(agentCalls(fake, "start")).toHaveLength(0)
      expect(fake.calls.some((call) => call.args.includes("remove") || call.args.includes("release"))).toBe(false)
    })
  }
}

test("invalid programmatic agent kinds fail before even resolving the repository", async () => {
  for (const agent of ["claude", "Pi", "", null]) {
    const fake = createFake()
    await expect(Effect.runPromise(createEnvironment({ ...lifecycleOptions, agent: agent as AgentKind }).pipe(Effect.provide(fake.layer))))
      .rejects.toThrow("agent must be pi or opencode")
    expect(fake.calls).toEqual([])
  }
})

test("startPi remains an exported compatible wrapper with exact default argv", async () => {
  const fake = createFake()
  await Effect.runPromise(startPi("wA:p1", "wt-feat-feature-wa", "feature", "task").pipe(Effect.provide(fake.layer)))
  expect(agentCalls(fake, "start")[0]?.args).toEqual([
    "agent", "start", "wt-feat-feature-wa", "--kind", "pi", "--pane", "wA:p1", "--timeout", "120000", "--", "--name", "feature"
  ])
  expect(agentCalls(fake, "prompt")).toHaveLength(1)
})
