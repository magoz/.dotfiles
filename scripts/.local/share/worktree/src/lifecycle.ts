import { Console, Effect, Either } from "effect"
import { type CreateOptions, type CreatedEnvironment, WorktreeError } from "./domain"
import { defaultWorktreePath, resolveBase, resolveRepository } from "./git"
import {
  agentNameFor,
  createHerdrWorktree,
  findRootPane,
  focusWorkspace,
  startPi
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
    const source = yield* resolveRepository(options.repo)
    const base = yield* resolveBase(source, options.base)
    const destinationPath = options.path ?? (yield* defaultWorktreePath(source, options.branch))
    const resolvedOptions = { ...options, path: destinationPath }

    yield* Console.log(`worktree: creating ${options.branch} from ${base}`)
    const created = yield* createHerdrWorktree(source, base, resolvedOptions)
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
    yield* Console.log(`worktree: starting Pi as ${agentName}`)
    yield* startPi(pane.pane_id, agentName, label, options.prompt).pipe(
      Effect.mapError((error) =>
        new WorktreeError({
          message:
            `Pi startup failed; preserved ready worktree ${destination} and Herdr workspace ${workspaceId}\n` +
            error.message
        })
      )
    )

    // Pi receives the kickoff as its initial CLI message, so task processing
    // starts as part of Pi startup instead of racing terminal input immediately
    // after Herdr reports the agent ready.
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
      warnings
    } satisfies CreatedEnvironment
  })
