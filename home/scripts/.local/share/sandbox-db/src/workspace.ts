import { Command, CommandExecutor, FileSystem, Path } from "@effect/platform"
import { Effect, Option, Redacted } from "effect"
import { PolicyError, WorkspaceError } from "./domain"

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Command.make("git", "-C", cwd, ...args)

/** stdout of a git command, or None when the command fails. */
const gitOutput = (cwd: string, args: ReadonlyArray<string>) =>
  Command.string(git(cwd, args)).pipe(
    Effect.map((out) => Option.some(out.trim())),
    Effect.orElseSucceed(() => Option.none<string>())
  )

const gitSucceeds = (cwd: string, args: ReadonlyArray<string>) =>
  Command.exitCode(git(cwd, args)).pipe(
    Effect.map((code) => code === 0),
    Effect.orElseSucceed(() => false)
  )

export interface Workspace {
  readonly root: string
  readonly repository: string
}

/** Resolve and validate the worktree root; refuse anything outside git. */
export const resolveWorkspace = (
  requested: Option.Option<string>
): Effect.Effect<Workspace, WorkspaceError, CommandExecutor.CommandExecutor | Path.Path | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const candidate = path.resolve(Option.getOrElse(requested, () => process.cwd()))

    const isDirectory = yield* fs.stat(candidate).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false)
    )
    if (!isDirectory) {
      return yield* Effect.fail(new WorkspaceError({ message: `not a directory: ${candidate}` }))
    }

    const inside = yield* gitOutput(candidate, ["rev-parse", "--is-inside-work-tree"])
    if (Option.getOrElse(inside, () => "") !== "true") {
      return yield* Effect.fail(
        new WorkspaceError({ message: `not inside a git worktree: ${candidate}` })
      )
    }

    const top = yield* gitOutput(candidate, ["rev-parse", "--show-toplevel"])
    const root = path.resolve(Option.getOrElse(top, () => candidate))

    const remote = yield* gitOutput(root, ["remote", "get-url", "origin"])
    const repository = Option.match(remote, {
      onNone: () => path.basename(root),
      onSome: (url) => {
        const match = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url)
        return match?.[1] ?? path.basename(root)
      }
    })

    return { root, repository } satisfies Workspace
  })

/**
 * Secrets may only be written to a path git will never track.
 * This is the guardrail that makes automatic provisioning safe.
 */
export const ensureIgnored = (root: string, envFile: string) =>
  Effect.gen(function* () {
    const tracked = yield* gitSucceeds(root, ["ls-files", "--error-unmatch", envFile])
    if (tracked) {
      return yield* Effect.fail(
        new PolicyError({ message: `refusing to write secrets: ${envFile} is tracked by git` })
      )
    }
    const ignored = yield* gitSucceeds(root, ["check-ignore", "-q", envFile])
    if (!ignored) {
      return yield* Effect.fail(
        new PolicyError({
          message:
            `refusing to write secrets: ${envFile} is not git-ignored\n` +
            "add it to .gitignore first"
        })
      )
    }
  })

export const writePrivately = (file: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const temporary = `${file}.sandbox-db.tmp`
    yield* fs.writeFileString(temporary, content)
    yield* fs.chmod(temporary, 0o600)
    yield* fs.rename(temporary, file)
  }).pipe(
    Effect.mapError((cause) => new WorkspaceError({ message: `env file write failed: ${cause}` }))
  )

const readLines = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
    if (!exists) return [] as ReadonlyArray<string>
    const content = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
    return content.split("\n")
  })

export const hasEnvKeys = (file: string, keys: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
    if (!exists) return false
    const lines = yield* readLines(file)
    return keys.every((key) => lines.some((line) => line.startsWith(`${key}=`)))
  })

/** The only place redacted connection material is unwrapped. */
export const writeEnvKeys = (
  file: string,
  values: ReadonlyArray<readonly [string, Redacted.Redacted<string>]>
) =>
  Effect.gen(function* () {
    const existing = yield* readLines(file)
    const keys = values.map(([key]) => key)
    const kept = existing.filter(
      (line) => !keys.some((key) => line.startsWith(`${key}=`))
    )
    while (kept.length > 0 && kept[kept.length - 1]!.trim() === "") kept.pop()
    const rendered = values.map(([key, value]) => `${key}=${Redacted.value(value)}`)
    yield* writePrivately(file, [...kept, ...rendered].join("\n") + "\n")
  })

export const removeEnvKeys = (file: string, keys: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
    if (!exists) return
    const existing = yield* readLines(file)
    const kept = existing.filter((line) => !keys.some((key) => line.startsWith(`${key}=`)))
    const body = kept.join("\n").trimEnd()
    yield* writePrivately(file, body.length > 0 ? `${body}\n` : "")
  })
