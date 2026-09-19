import { Console, Effect, Either } from "effect"
import { type CreateOptions, type CreatedEnvironment, WorktreeError, agentDisplayName, resolveAgentKind } from "./domain"
import { defaultWorktreePath, requireNewBranch, resolveBase, resolvePrimaryRoot, resolveRepository } from "./git"
import {
  agentNameFor,
  createHerdrWorktree,
  findRootPane,
  focusWorkspace,
  startAgent
} from "./herdr"
import { Process } from "./process"

const runProvisioning = (
  source: string,
  destination: string,
  label: string,
  ttl: string
) =>
  Effect.gen(function* () {
    const process = yield* Process
    yield* Console.log(`worktree: provisioning ${destination}`)
    yield* process.inherit("provision-env", [
      "--repo",
      destination,
      "--source",
      source,
      "--database",
      "--non-interactive",
      "--label",
      label,
      "--ttl",
      ttl
    ])
  })

const runSetupCommands = (destination: string, commands: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (commands.length === 0) return
    const process = yield* Process
    const shell = processEnvShell()
    for (const command of commands) {
      yield* Console.log(`worktree: setup: ${command}`)
      yield* process.inherit(shell, ["-lc", command], { cwd: destination })
    }
  })

const processEnvShell = () => process.env.SHELL || "/bin/sh"

export const createEnvironment = (options: CreateOptions) =>
  Effect.gen(function* () {
    const agentKind = yield* resolveAgentKind(options.agent)
    const agentLabel = agentDisplayName(agentKind)
    const source = yield* resolveRepository(options.repo)
    // Herdr groups new worktrees under the repo parent workspace and rejects
    // linked checkouts as the create source (linked_worktree_source), so always
    // hand Herdr the primary root while provisioning stays sourced from the
    // invoking checkout.
    const herdrSource = yield* resolvePrimaryRoot(source)
    if (herdrSource !== source) {
      yield* Console.log(`worktree: using primary checkout ${herdrSource} for Herdr (invoked from linked worktree ${source})`)
    }
    if (options.base === undefined) yield* requireNewBranch(herdrSource, options.branch)
    const base = yield* resolveBase(herdrSource, options.base)
    const destinationPath = options.path ?? (yield* defaultWorktreePath(herdrSource, options.branch))
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
