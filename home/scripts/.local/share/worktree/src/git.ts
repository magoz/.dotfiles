import { Console, Effect } from "effect"
import { randomUUID } from "node:crypto"
import { basename, dirname, join } from "node:path"
import { WorktreeError } from "./domain"
import { Process } from "./process"

const output = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const process = yield* Process
    const result = yield* process.capture("git", ["-C", cwd, ...args])
    return result.stdout.trim()
  })

const refExists = (repo: string, ref: string) =>
  Effect.gen(function* () {
    const process = yield* Process
    return yield* process.capture("git", ["-C", repo, "rev-parse", "--verify", "--quiet", "--end-of-options", ref]).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false)
    )
  })

export const resolveRepository = (requested: string) =>
  output(requested, ["rev-parse", "--show-toplevel"]).pipe(
    Effect.mapError(
      () => new WorktreeError({ message: `not inside a Git checkout: ${requested}` })
    )
  )

export const branchPathSlug = (branch: string) => {
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "")
  if (slug.length === 0) {
    throw new WorktreeError({ message: `cannot derive a checkout path from branch: ${branch}` })
  }
  return slug
}

/** Place linked checkouts beside the primary repository, even when invoked from another worktree. */
export const defaultWorktreePath = (repo: string, branch: string) =>
  Effect.gen(function* () {
    const commonDirectory = yield* output(repo, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir"
    ])
    const primaryRoot = basename(commonDirectory) === ".git" ? dirname(commonDirectory) : repo
    const slug = yield* Effect.try({
      try: () => branchPathSlug(branch),
      catch: (error) =>
        error instanceof WorktreeError
          ? error
          : new WorktreeError({ message: `could not derive checkout path: ${error}` })
    })
    return join(dirname(primaryRoot), `${basename(primaryRoot)}-${slug}`)
  }).pipe(
    Effect.mapError((error) =>
      error instanceof WorktreeError
        ? error
        : new WorktreeError({ message: `could not derive sibling worktree path: ${error.message}` })
    )
  )

export const requireNewBranch = (repo: string, branch: string) =>
  Effect.gen(function* () {
    if (yield* refExists(repo, `refs/heads/${branch}`)) {
      return yield* Effect.fail(new WorktreeError({
        message: `branch already exists: ${branch}; choose a new branch name for a fresh default base, ` +
          "or supply --base only when intentionally continuing existing history"
      }))
    }
  })

export const resolveBase = (repo: string, requested?: string) =>
  Effect.gen(function* () {
    if (requested !== undefined) {
      if (!(yield* refExists(repo, `${requested}^{commit}`))) {
        return yield* Effect.fail(
          new WorktreeError({ message: `base ref does not exist: ${requested}` })
        )
      }
      return requested
    }

    // Fetch the server's HEAD, not the potentially stale local origin/HEAD.
    // A per-invocation ref avoids races with other fetches sharing FETCH_HEAD.
    const ref = `refs/worktree-bases/${randomUUID()}`
    yield* Console.log("worktree: fetching origin's current default branch")
    return yield* Effect.gen(function* () {
      yield* output(repo, [
        "fetch", "--no-tags", "--no-write-fetch-head", "--refmap=",
        "origin", `HEAD:${ref}`
      ])
      // Pass an immutable commit to Herdr, never a moving remote-tracking ref.
      return yield* output(repo, ["rev-parse", "--verify", `${ref}^{commit}`])
    }).pipe(
      Effect.mapError((error) => new WorktreeError({
        message: "cannot fetch origin's current default branch; refusing a stale local base. " +
          "Retry when origin is available, or supply --base only for an intentional override.\n" +
          error.message
      })),
      Effect.ensuring(
        output(repo, ["update-ref", "-d", ref]).pipe(
          Effect.catchAll((error) => Console.error(
            `worktree: warning: could not remove temporary ref ${ref}: ${error.message}`
          ))
        )
      )
    )
  })
