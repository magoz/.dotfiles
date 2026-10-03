import { Console, Effect } from "effect"
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  type CheckedOutEnvironment,
  type CheckoutFailure,
  type CheckoutOptions,
  CheckoutError,
  type ProcessError,
  WorktreeError
} from "./domain"
import { Process } from "./process"
import { resolveBranchBase, resolveSource, runInstallOnly, runProvisioning, runSetupCommands } from "./steps"

/**
 * How a provision-only checkout is provisioned. Decided from local evidence only
 * (no network, no env-file reads), so unlinked repositories never fail:
 *
 * - `full`: the repository is configured for Vercel provisioning. Runs
 *   `provision-env --database` exactly like `worktree create`; any failure fails.
 * - `install`: not configured for Vercel; a lockfile provision-env supports
 *   exists, so only dependencies are installed (`--skip-vercel`, no databases).
 * - `none`: not configured and no supported lockfile; provision-env is skipped.
 *
 * Skipping is always reported as a warning, never a failure.
 */
export type ProvisioningPlan =
  | { readonly kind: "full" }
  | { readonly kind: "install"; readonly lockfile: string }
  | { readonly kind: "none" }

/** Must match provision-env's installDependencies() detection order. */
export const SUPPORTED_LOCKFILES = ["pnpm-lock.yaml", "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock"] as const

export const NO_VERCEL_WARNING =
  "no Vercel configuration (no .vercel/project.json in any checkout, no package.json provisionEnv); " +
  "skipped Vercel environment pull and sandbox databases"
export const NO_LOCKFILE_WARNING = "no supported lockfile; skipped dependency install"

const declaresProvisionEnv = (checkout: string) => {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8"))
    return typeof manifest === "object" && manifest !== null && "provisionEnv" in manifest
  } catch {
    // Missing or unreadable manifests are not configuration evidence.
    return false
  }
}

/**
 * A repository is "Vercel-configured" when its source package.json declares
 * `provisionEnv` (explicit opt-in, e.g. a monorepo appDir), or when any of its
 * checkouts has a root `.vercel/project.json` (the link provision-env reuses
 * from siblings). Configured-but-unlinked repos still fail in provision-env.
 */
export const isVercelConfigured = (source: string) =>
  Effect.gen(function* () {
    if (declaresProvisionEnv(source)) return true
    const process = yield* Process
    const listed = yield* process.capture("git", ["-C", source, "worktree", "list", "--porcelain", "-z"])
    const checkouts = listed.stdout.split("\0")
      .filter((field) => field.startsWith("worktree "))
      .map((field) => field.slice("worktree ".length))
    return [source, ...checkouts].some((checkout) => existsSync(join(checkout, ".vercel", "project.json")))
  })

export const planProvisioning = (vercelConfigured: boolean, destination: string): ProvisioningPlan => {
  if (vercelConfigured) return { kind: "full" }
  const lockfile = SUPPORTED_LOCKFILES.find((name) => existsSync(join(destination, name)))
  return lockfile === undefined ? { kind: "none" } : { kind: "install", lockfile }
}

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
    const vercelConfigured = yield* isVercelConfigured(source).pipe(preflight)

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

    const preserved = (stage: "provision" | "setup") =>
      fail(branch, { stage, path: destination, base }, `${stage} failed; preserved checkout ${destination} on branch ${branch}`)
    const warnings: Array<string> = []
    const plan = planProvisioning(vercelConfigured, destination)
    switch (plan.kind) {
      case "full":
        yield* runProvisioning(source, destination, options.label ?? branch, options.ttl).pipe(preserved("provision"))
        break
      case "install":
        warnings.push(NO_VERCEL_WARNING)
        yield* runInstallOnly(destination).pipe(preserved("provision"))
        break
      case "none":
        warnings.push(NO_VERCEL_WARNING, NO_LOCKFILE_WARNING)
        break
    }
    yield* runSetupCommands(destination, options.setupCommands).pipe(preserved("setup"))
    for (const warning of warnings) yield* Console.error(`worktree: warning: ${warning}`)

    return { source, branch, base, path: destination, warnings } satisfies CheckedOutEnvironment
  })
