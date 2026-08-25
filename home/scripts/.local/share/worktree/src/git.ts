import { Effect } from "effect"
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
    return yield* process.capture("git", ["-C", repo, "rev-parse", "--verify", "--quiet", ref]).pipe(
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

export const resolveBase = (repo: string, requested?: string) =>
  Effect.gen(function* () {
    if (requested) {
      if (!(yield* refExists(repo, requested))) {
        return yield* Effect.fail(
          new WorktreeError({ message: `base ref does not exist: ${requested}` })
        )
      }
      return requested
    }

    const process = yield* Process
    const remoteHead = yield* process.capture(
      "git",
      ["-C", repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]
    ).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.orElseSucceed(() => "")
    )
    if (remoteHead.length > 0 && (yield* refExists(repo, remoteHead))) return remoteHead

    for (const candidate of ["origin/main", "main", "origin/master", "master"]) {
      if (yield* refExists(repo, candidate)) return candidate
    }

    return "HEAD"
  })
