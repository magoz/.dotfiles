import { Console, Effect, Either } from "effect"
import { type CreateOptions, type CreatedEnvironment, WorktreeError, agentDisplayName, resolveAgentKind } from "./domain"
import {
  agentNameFor,
  createHerdrWorktree,
  findRootPane,
  focusWorkspace,
  startAgent
} from "./herdr"
import { resolveBranchBase, resolveSource, runProvisioning, runSetupCommands } from "./steps"

export const createEnvironment = (options: CreateOptions) =>
  Effect.gen(function* () {
    const agentKind = yield* resolveAgentKind(options.agent)
    const agentLabel = agentDisplayName(agentKind)
    // Herdr groups new worktrees under the repo parent workspace and rejects
    // linked checkouts as the create source (linked_worktree_source), so always
    // hand Herdr the primary root while provisioning stays sourced from the
    // invoking checkout.
    const { source, primary: herdrSource } = yield* resolveSource(options.repo)
    if (herdrSource !== source) {
      yield* Console.log(`worktree: using primary checkout ${herdrSource} for Herdr (invoked from linked worktree ${source})`)
    }
    const { base, path: destinationPath } = yield* resolveBranchBase(herdrSource, options, "default-base")
    const resolvedOptions = { ...options, path: destinationPath }

    yield* Console.log(`worktree: creating ${options.branch} from ${base}`)
    const created = yield* createHerdrWorktree(herdrSource, base, resolvedOptions)
    const destination = created.result.worktree.path
    const workspaceId = created.result.workspace.workspace_id
    const pane = yield* findRootPane(workspaceId)
    const label = options.label ?? options.branch

    yield* runProvisioning(source, destination, label, options.ttl).pipe(
      Effect.mapError((error) =>
        new WorktreeError({
          message:
            `provisioning failed; preserved worktree ${destination} and Herdr workspace ${workspaceId}\n` +
            error.message
        })
      )
    )
    yield* runSetupCommands(destination, options.setupCommands).pipe(
      Effect.mapError((error) =>
        new WorktreeError({
          message:
            `setup failed; preserved worktree ${destination} and Herdr workspace ${workspaceId}\n` +
            error.message
        })
      )
    )

    const agentName = agentNameFor(options.branch, workspaceId)
    yield* Console.log(`worktree: starting ${agentLabel} as ${agentName}`)
    yield* startAgent(agentKind, pane.pane_id, agentName, label, options.prompt).pipe(
      Effect.mapError((error) =>
        new WorktreeError({
          message:
            `${agentLabel} startup failed; preserved ready worktree ${destination} and Herdr workspace ${workspaceId}\n` +
            error.message
        })
      )
    )

    // Submit the kickoff only after verifying the selected harness is interactive.
    // Launch and prompt are never blindly retried.
    const warnings: Array<string> = []
    const focused = yield* Effect.either(focusWorkspace(workspaceId))
    if (Either.isLeft(focused)) {
      warnings.push(`destination workspace was not focused: ${focused.left.message}`)
    }
    for (const warning of warnings) yield* Console.error(`worktree: warning: ${warning}`)

    return {
      source,
      branch: created.result.worktree.branch ?? options.branch,
      base,
      path: destination,
      workspaceId,
      paneId: pane.pane_id,
      agentName,
      agentKind,
      warnings
    } satisfies CreatedEnvironment
  })
