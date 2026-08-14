import { Effect, Schema } from "effect"
import {
  AgentInfoResponse,
  AgentStartedResponse,
  PaneListResponse,
  WorktreeCreatedResponse,
  WorktreeError,
  type ProcessError,
  type CreateOptions
} from "./domain"
import { Process } from "./process"

const decodeJson = <A, I>(schema: Schema.Schema<A, I>, value: string, subject: string) =>
  Schema.decodeUnknown(Schema.parseJson(schema))(value).pipe(
    Effect.mapError(
      (error) => new WorktreeError({ message: `invalid ${subject} response from Herdr: ${error}` })
    )
  )

export const buildCreateArgs = (
  repo: string,
  base: string,
  options: CreateOptions
): ReadonlyArray<string> => {
  const args = [
    "worktree",
    "create",
    "--cwd",
    repo,
    "--branch",
    options.branch,
    "--base",
    base
  ]
  if (options.path) args.push("--path", options.path)
  if (options.label) args.push("--label", options.label)
  args.push("--no-focus")
  return args
}

export const createHerdrWorktree = (repo: string, base: string, options: CreateOptions) =>
  Effect.gen(function* () {
    const process = yield* Process
    const response = yield* process.capture("herdr", buildCreateArgs(repo, base, options))
    return yield* decodeJson(WorktreeCreatedResponse, response.stdout, "worktree create")
  })

export const findRootPane = (workspaceId: string) =>
  Effect.gen(function* () {
    const process = yield* Process
    const response = yield* process.capture("herdr", [
      "pane",
      "list",
      "--workspace",
      workspaceId
    ])
    const decoded = yield* decodeJson(PaneListResponse, response.stdout, "pane list")
    const panes = decoded.result.panes.filter((pane) => pane.workspace_id === workspaceId)
    if (panes.length !== 1) {
      return yield* Effect.fail(
        new WorktreeError({
          message: `new Herdr workspace ${workspaceId} has ${panes.length} panes; expected exactly one`
        })
      )
    }
    return panes[0]!
  })

export const agentNameFor = (branch: string, workspaceId: string) => {
  const branchSlug = branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const workspaceSlug = workspaceId.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const suffix = workspaceSlug.slice(-6) || "new"
  const prefix = branchSlug.length > 0 ? branchSlug : "worktree"
  return `wt-${prefix.slice(0, Math.max(1, 28 - suffix.length))}-${suffix}`.slice(0, 32)
}

const verifyReadyAgent = (agentName: string, paneId: string) =>
  Effect.gen(function* () {
    const process = yield* Process
    const response = yield* process.capture("herdr", ["agent", "get", agentName])
    const decoded = yield* decodeJson(AgentInfoResponse, response.stdout, "agent get")
    const agent = decoded.result.agent
    if (
      agent.pane_id !== paneId ||
      agent.name !== agentName ||
      agent.interactive_ready !== true ||
      agent.launch_pending === true
    ) {
      return yield* Effect.fail(
        new WorktreeError({ message: `Pi agent ${agentName} is not ready in pane ${paneId}` })
      )
    }
  })

const isAgentStartTimeout = (error: ProcessError | WorktreeError) => {
  if (error._tag !== "ProcessError") return false
  for (const output of [error.stdout, error.stderr]) {
    try {
      const parsed = JSON.parse(output) as { readonly error?: { readonly code?: unknown } }
      if (parsed.error?.code === "cli:agent:start:timeout") return true
    } catch {
      // Herdr command errors are expected to be JSON; unstructured errors fail closed.
    }
  }
  return false
}

const verifyDetectedPi = (paneId: string) =>
  Effect.gen(function* () {
    const process = yield* Process
    const response = yield* process.capture("herdr", ["agent", "get", paneId])
    const decoded = yield* decodeJson(AgentInfoResponse, response.stdout, "agent get by pane")
    const agent = decoded.result.agent
    if (
      agent.pane_id !== paneId ||
      agent.agent !== "pi" ||
      !["idle", "working"].includes(agent.agent_status ?? "")
    ) {
      return yield* Effect.fail(
        new WorktreeError({ message: `Pi was not detected in pane ${paneId}` })
      )
    }
  })

export const startPi = (
  paneId: string,
  agentName: string,
  sessionName: string,
  prompt?: string
) =>
  Effect.gen(function* () {
    const process = yield* Process
    const launch = process
      .capture("herdr", [
        "agent",
        "start",
        agentName,
        "--kind",
        "pi",
        "--pane",
        paneId,
        "--timeout",
        "120000",
        "--",
        "--name",
        sessionName
      ])
      .pipe(
        Effect.flatMap((started) =>
          decodeJson(AgentStartedResponse, started.stdout, "agent start")
        ),
        Effect.flatMap((decoded) =>
          decoded.result.agent.pane_id === paneId
            ? Effect.void
            : Effect.fail(
                new WorktreeError({ message: "Herdr started Pi in an unexpected pane" })
              )
        )
      )

    const recoveredFromTimeout = yield* launch.pipe(
      Effect.as(false),
      Effect.catchAll((startError) =>
        isAgentStartTimeout(startError)
          ? verifyDetectedPi(paneId).pipe(
              Effect.as(true),
              Effect.catchAll(() => Effect.fail(startError))
            )
          : Effect.fail(startError)
      )
    )
    if (!recoveredFromTimeout) yield* verifyReadyAgent(agentName, paneId)

    if (prompt?.trim()) {
      yield* process.capture("herdr", ["agent", "prompt", paneId, prompt.trim()])
    }
  })

export const focusWorkspace = (workspaceId: string) =>
  Effect.gen(function* () {
    const process = yield* Process
    yield* process.capture("herdr", ["workspace", "focus", workspaceId])
  })
