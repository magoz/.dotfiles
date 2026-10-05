import { Console, Effect, Schema } from "effect"
import { WorktreeError } from "./domain"
import { defaultWorktreePath, requireNewBranch, resolveBase, resolvePrimaryRoot, resolveRepository } from "./git"
import { Process } from "./process"

/**
 * Steps shared by `worktree create` (Herdr + agent) and `worktree checkout`
 * (provision-only). Each step keeps the exact argv and fail-closed semantics
 * the Herdr flow has always used; callers own error wrapping and ordering.
 */

/** The invoking checkout plus the primary root that owns sibling placement. */
export const resolveSource = (repo: string) =>
  Effect.gen(function* () {
    const source = yield* resolveRepository(repo)
    const primary = yield* resolvePrimaryRoot(source)
    return { source, primary } as const
  })

/**
 * When the destination branch must be new:
 * - `default-base`: only when the base is the freshly fetched origin tip
 *   (an explicit --base may continue existing history; Herdr's behaviour);
 * - `always`: every invocation (checkout always runs `git worktree add -b`).
 */
export type NewBranchPolicy = "default-base" | "always"

/** Validate the branch, pin the base, and resolve the destination path, before allocating anything. */
export const resolveBranchBase = (
  primary: string,
  options: { readonly branch: string; readonly base?: string; readonly path?: string },
  policy: NewBranchPolicy
) =>
  Effect.gen(function* () {
    if (policy === "always" || options.base === undefined) {
      yield* requireNewBranch(primary, options.branch)
    }
    const base = yield* resolveBase(primary, options.base)
    const path = options.path ?? (yield* defaultWorktreePath(primary, options.branch))
    return { base, path } as const
  })

/** Full provisioning: Vercel Development/test env pull plus two sandbox database leases. */
export const runProvisioning = (
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

/** Dependency install only: no Vercel pull, no env files, no databases. */
export const runInstallOnly = (destination: string) =>
  Effect.gen(function* () {
    const process = yield* Process
    yield* Console.log(`worktree: installing dependencies in ${destination}`)
    yield* process.inherit("provision-env", [
      "--repo",
      destination,
      "--skip-vercel",
      "--non-interactive"
    ])
  })

const SetupCommand = Schema.String.pipe(
  Schema.filter((command) => command.trim().length > 0, { message: () => "setup commands must be non-empty strings" })
)
const Manifest = Schema.Struct({
  worktree: Schema.optional(Schema.Struct({ setup: Schema.optional(Schema.Array(SetupCommand)) }))
})

/**
 * Repository-declared setup: root package.json `worktree.setup` (e.g. migrations
 * for freshly leased sandbox databases), read from the pinned base, i.e. the code
 * the new checkout will contain. Read before allocating anything, so a malformed
 * declaration fails preflight. No package.json or no key means no commands.
 * Callers run these after provisioning and before their own --setup commands.
 */
export const readDeclaredSetup = (repo: string, base: string) =>
  Effect.gen(function* () {
    const process = yield* Process
    const listed = yield* process.capture("git", ["-C", repo, "ls-tree", "--name-only", "--end-of-options", base, "--", "package.json"])
    if (listed.stdout.trim() !== "package.json") return []
    const manifest = yield* process.capture("git", ["-C", repo, "show", "--end-of-options", `${base}:package.json`])
    const decoded = yield* Schema.decodeUnknown(Schema.parseJson(Manifest))(manifest.stdout).pipe(
      Effect.mapError((error) => new WorktreeError({ message: `invalid package.json worktree.setup at ${base}: ${error.message}` }))
    )
    return decoded.worktree?.setup ?? []
  })

export const runSetupCommands = (destination: string, commands: ReadonlyArray<string>) =>
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
