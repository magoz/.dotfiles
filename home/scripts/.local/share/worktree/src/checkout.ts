import { Console, Effect } from "effect"
import { lstatSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import {
  type CheckedOutEnvironment,
  type CheckoutFailure,
  type CheckoutOptions,
  CheckoutError,
  type ProcessError,
  WorktreeError
} from "./domain"
import { markerPath, writeMarker } from "./marker"
import { Process } from "./process"
import { readDeclaredSetup, resolveBranchBase, resolveSource, runProvisioning, runSetupCommands } from "./steps"

const fail = (branch: string, failure: CheckoutFailure, prefix?: string) =>
  Effect.mapError((error: WorktreeError | ProcessError) => new CheckoutError({
    branch,
    failure,
    message: prefix === undefined ? error.message : `${prefix}\n${error.message}`
  }))

const gitOutput = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const process = yield* Process
    return (yield* process.capture("git", ["-C", cwd, ...args])).stdout.trim()
  })

/** Reject names git would refuse or rewrite (e.g. `@{-1}`), before fetching anything. */
const validateBranchName = (repo: string, branch: string) =>
  gitOutput(repo, ["check-ref-format", "--branch", branch]).pipe(
    Effect.catchAll(() => Effect.succeed("")),
    Effect.flatMap((normalized) => normalized === branch
      ? Effect.void
      : Effect.fail(new WorktreeError({ message: `invalid branch name: ${JSON.stringify(branch)}` })))
  )

/** lstat, not exists(): a dangling symlink also occupies the destination. */
const requireAbsent = (path: string) =>
  Effect.suspend(() => {
    try {
      lstatSync(path)
    } catch {
      return Effect.void
    }
    return Effect.fail(new WorktreeError({ message: `destination already exists: ${path}` }))
  })

/**
 * Herdr-free, agent-free creation: the same fresh base, sibling path and
 * provisioning as `worktree create`, using plain `git worktree add`. Nothing is
 * rolled back after allocation; failures report what exists (CheckoutFailure).
 */
export const checkoutEnvironment = (options: CheckoutOptions) =>
  Effect.gen(function* () {
    const branch = options.branch
    const preflight = fail(branch, { stage: "preflight" })

    const { source, primary } = yield* resolveSource(options.repo).pipe(preflight)
    yield* validateBranchName(primary, branch).pipe(preflight)
    const { base, path: requested } = yield* resolveBranchBase(primary, {
      branch,
      ...(options.base === undefined ? {} : { base: options.base }),
      ...(options.path === undefined ? {} : { path: resolve(options.path) })
    }, "always").pipe(preflight)
    yield* requireAbsent(requested).pipe(preflight)
    // Validated before allocating anything; `provision env` runs it after provisioning.
    yield* readDeclaredSetup(primary, base).pipe(preflight)

    yield* Console.log(`worktree: checking out ${branch} from ${base} at ${requested}`)
    const runner = yield* Process
    const created = fail(branch, { stage: "create", path: requested }, `git worktree add failed; inspect ${requested} and branch ${branch}`)
    yield* runner.inherit("git", ["-C", primary, "worktree", "add", "-b", branch, "--", requested, base]).pipe(created)
    const destination = yield* Effect.try({
      try: () => realpathSync(requested),
      catch: () => new WorktreeError({ message: `created checkout is not accessible: ${requested}` })
    }).pipe(created)
    if ((yield* gitOutput(destination, ["branch", "--show-current"]).pipe(created)) !== branch) {
      return yield* Effect.fail(new CheckoutError({
        branch,
        failure: { stage: "create", path: destination },
        message: `checkout at ${destination} is not on branch ${branch}; preserved for inspection`
      }))
    }
    // Ownership marker before provisioning: a checkout whose provisioning fails
    // stays owned (listed by OpenCode) and retirable through retire-checkout.
    const gitDir = yield* gitOutput(destination, ["rev-parse", "--absolute-git-dir"]).pipe(created)
    yield* Effect.try({
      try: () => writeMarker(gitDir, branch),
      catch: (error) => new WorktreeError({ message: `cannot write ownership marker ${markerPath(gitDir)}: ${error}` })
    }).pipe(fail(branch, { stage: "create", path: destination }, `checkout ${destination} exists on branch ${branch} but is not marked as dotfiles-owned`))

    const preserved = (stage: "provision" | "setup") =>
      fail(branch, { stage, path: destination, base }, `${stage} failed; preserved checkout ${destination} on branch ${branch}`)
    // `provision env` decides what the checkout needs (a Vercel app gets env files and databases,
    // anything else only an install) and runs the declared setup; it prints its own warnings.
    yield* runProvisioning(source, destination, options.label ?? branch, options.ttl).pipe(preserved("provision"))
    yield* runSetupCommands(destination, options.setupCommands).pipe(preserved("setup"))

    return { source, branch, base, path: destination, warnings: [] } satisfies CheckedOutEnvironment
  })
