import { Prompt } from "@effect/cli"
import { FileSystem, Path } from "@effect/platform"
import { Cause, Console, Effect, Either, Option, Schema } from "effect"
import {
  ProvisionError,
  type EnvConflictPolicy,
  type ProvisionOptions
} from "./provision-domain"
import { ProvisionProcess } from "./provision-process"

interface RollbackState {
  createdLocalEnv: boolean
  createdTestEnv: boolean
  createdDefaultLease: boolean
  createdTestLease: boolean
  localEnvSnapshot?: string
  testEnvSnapshot?: string
  localPullTemporary?: string
  testPullTemporary?: string
}

const fail = (message: string) => Effect.fail(new ProvisionError({ message }))

const mapFileError = (message: string) =>
  Effect.mapError((cause: unknown) => new ProvisionError({ message: `${message}: ${cause}` }))

const deploymentMetadataKeys = new Set([
  "CI",
  "NX_DAEMON",
  "TURBO_CACHE",
  "TURBO_DOWNLOAD_LOCAL_ENABLED",
  "TURBO_REMOTE_ONLY",
  "TURBO_RUN_SUMMARY",
  "VERCEL",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_BRANCH_URL",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_AUTHOR_LOGIN",
  "VERCEL_GIT_COMMIT_AUTHOR_NAME",
  "VERCEL_GIT_COMMIT_MESSAGE",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_PREVIOUS_SHA",
  "VERCEL_GIT_PROVIDER",
  "VERCEL_GIT_PULL_REQUEST_ID",
  "VERCEL_GIT_REPO_ID",
  "VERCEL_GIT_REPO_OWNER",
  "VERCEL_GIT_REPO_SLUG",
  "VERCEL_HASH_SALT",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_PROJECT_ID",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_REGION",
  "VERCEL_SKEW_PROTECTION_ENABLED",
  "VERCEL_TARGET_ENV",
  "VERCEL_URL"
])

const databaseUrlKeys = new Set(["DATABASE_URL", "DATABASE_URL_UNPOOLED"])

export const stripPulledEnvironment = (
  content: string,
  explicitKeys: ReadonlySet<string>,
  replaceDatabaseUrls: boolean
) => {
  let metadataRemoved = 0
  let databaseUrlsRemoved = 0
  const lines = content.split("\n").filter((line) => {
    const key = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1]
    if (key === undefined) return true
    if (replaceDatabaseUrls && databaseUrlKeys.has(key)) {
      databaseUrlsRemoved += 1
      return false
    }
    if (explicitKeys.has(key) || !deploymentMetadataKeys.has(key)) return true
    metadataRemoved += 1
    return false
  })
  return {
    content: lines.join("\n"),
    databaseUrlsRemoved,
    metadataRemoved
  } as const
}

const listExplicitVercelKeys = (repo: string, environment: string) =>
  Effect.gen(function* () {
    const process = yield* ProvisionProcess
    const listed = yield* process.capture("vercel", [
      "env",
      "list",
      environment,
      "--cwd",
      repo,
      "--no-color"
    ])
    return new Set(
      listed.stdout.split("\n").flatMap((line) => {
        const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(line)?.[1]
        return key === undefined ? [] : [key]
      })
    )
  })

const sanitizePulledEnvironment = (
  file: string,
  label: string,
  explicitKeys: ReadonlySet<string>,
  replaceDatabaseUrls: boolean
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const pulled = yield* fs.readFileString(file).pipe(
      mapFileError(`cannot inspect pulled ${label} environment`)
    )
    const sanitized = stripPulledEnvironment(pulled, explicitKeys, replaceDatabaseUrls)
    if (sanitized.metadataRemoved === 0 && sanitized.databaseUrlsRemoved === 0) return
    yield* fs.writeFileString(file, sanitized.content).pipe(
      mapFileError(`cannot sanitize pulled ${label} environment`)
    )
    yield* fs.chmod(file, 0o600).pipe(
      mapFileError(`cannot protect sanitized ${label} environment`)
    )
    if (sanitized.metadataRemoved > 0) {
      yield* Console.log(
        `provision-env: removed ${sanitized.metadataRemoved} deployment-only variables from ${label}`
      )
    }
    if (sanitized.databaseUrlsRemoved > 0) {
      yield* Console.log(
        `provision-env: removed ${sanitized.databaseUrlsRemoved} Vercel database variables from ${label}`
      )
    }
  })

const gitOutput = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const process = yield* ProvisionProcess
    return (yield* process.capture("git", ["-C", cwd, ...args])).stdout.trim()
  })

const gitSucceeds = (cwd: string, args: ReadonlyArray<string>) =>
  gitOutput(cwd, args).pipe(
    Effect.as(true),
    Effect.catchAll(() => Effect.succeed(false))
  )

const resolveCheckout = (requested: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const candidate = path.resolve(requested)
    const directory = yield* fs.stat(candidate).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.catchAll(() => Effect.succeed(false))
    )
    if (!directory) return yield* fail(`not a directory: ${candidate}`)

    const inside = yield* gitOutput(candidate, ["rev-parse", "--is-inside-work-tree"]).pipe(
      Effect.catchAll(() => Effect.succeed("false"))
    )
    if (inside !== "true") return yield* fail(`not a Git checkout: ${candidate}`)

    return path.resolve(yield* gitOutput(candidate, ["rev-parse", "--show-toplevel"]))
  })

const ensureSecretPath = (repo: string, relativeFile: string) =>
  Effect.gen(function* () {
    if (yield* gitSucceeds(repo, ["ls-files", "--error-unmatch", "--", relativeFile])) {
      return yield* fail(`refusing to write ${relativeFile} because it is tracked`)
    }
    if (!(yield* gitSucceeds(repo, ["check-ignore", "-q", "--", relativeFile]))) {
      return yield* fail(`refusing to write ${relativeFile} because it is not git-ignored`)
    }
  })

const installDependencies = (repo: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const process = yield* ProvisionProcess
    const exists = (file: string) => fs.exists(path.join(repo, file)).pipe(Effect.orElseSucceed(() => false))

    if (yield* exists("pnpm-lock.yaml")) {
      yield* Console.log("provision-env: installing dependencies with pnpm --frozen-lockfile")
      return yield* process.inherit("pnpm", ["--dir", repo, "install", "--frozen-lockfile"])
    }
    if ((yield* exists("bun.lock")) || (yield* exists("bun.lockb"))) {
      yield* Console.log("provision-env: installing dependencies with bun --frozen-lockfile")
      return yield* process.inherit("bun", ["install", "--frozen-lockfile"], { cwd: repo })
    }
    if (yield* exists("package-lock.json")) {
      yield* Console.log("provision-env: installing dependencies with npm ci")
      return yield* process.inherit("npm", ["ci"], { cwd: repo })
    }
    if (yield* exists("yarn.lock")) {
      const version = yield* process.capture("yarn", ["--version"])
      const major = Number(version.stdout.trim().split(".")[0])
      const immutable = Number.isInteger(major) && major >= 2
      yield* Console.log(
        `provision-env: installing dependencies with yarn ${immutable ? "--immutable" : "--frozen-lockfile"}`
      )
      return yield* process.inherit(
        "yarn",
        ["install", immutable ? "--immutable" : "--frozen-lockfile"],
        { cwd: repo }
      )
    }

    return yield* fail(`no supported lockfile found in ${repo}`)
  })

const copyProjectIdentity = (repo: string, source: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const from = yield* resolveCheckout(source)
    const sourceProjectFile = path.join(from, ".vercel", "project.json")
    const sourceLinked = yield* fs.exists(sourceProjectFile).pipe(Effect.orElseSucceed(() => false))
    if (!sourceLinked) return yield* fail(`source checkout is not linked to Vercel: ${from}`)

    const targetRemote = yield* gitOutput(repo, ["remote", "get-url", "origin"]).pipe(
      Effect.catchAll(() => Effect.succeed(""))
    )
    const sourceRemote = yield* gitOutput(from, ["remote", "get-url", "origin"]).pipe(
      Effect.catchAll(() => Effect.succeed(""))
    )
    if (targetRemote.length > 0 && sourceRemote.length > 0 && targetRemote !== sourceRemote) {
      return yield* fail(`refusing Vercel identity from a different Git remote: ${from}`)
    }
    if (!(yield* gitSucceeds(repo, ["check-ignore", "-q", "--", ".vercel/project.json"]))) {
      return yield* fail("refusing to create .vercel/project.json because .vercel is not ignored")
    }

    const targetDirectory = path.join(repo, ".vercel")
    const targetProjectFile = path.join(targetDirectory, "project.json")
    yield* fs.makeDirectory(targetDirectory, { recursive: true }).pipe(
      mapFileError("cannot create .vercel directory")
    )
    yield* fs.chmod(targetDirectory, 0o700).pipe(mapFileError("cannot protect .vercel directory"))
    yield* fs.copyFile(sourceProjectFile, targetProjectFile).pipe(
      mapFileError("cannot copy Vercel project identity")
    )
    yield* fs.chmod(targetProjectFile, 0o600).pipe(
      mapFileError("cannot protect Vercel project identity")
    )
    yield* Console.log(`provision-env: reused Vercel project identity from ${from}`)
  })

const readVercelIdentity = (projectFile: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const content = yield* fs.readFileString(projectFile).pipe(
      mapFileError(`cannot read Vercel project identity from ${projectFile}`)
    )
    const parsed = yield* Effect.try({
      try: () => JSON.parse(content) as unknown,
      catch: (cause) =>
        new ProvisionError({
          message: `invalid Vercel project identity in ${projectFile}: ${cause}`
        })
    })
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("projectId" in parsed) ||
      typeof parsed.projectId !== "string" ||
      !("orgId" in parsed) ||
      typeof parsed.orgId !== "string"
    ) {
      return yield* fail(`invalid Vercel project identity in ${projectFile}`)
    }
    return `${parsed.orgId}:${parsed.projectId}`
  })

const ensureVercelLink = (
  repo: string,
  source: string | undefined,
  vercelProject: string | undefined
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const process = yield* ProvisionProcess
    const projectFile = path.join(repo, ".vercel", "project.json")
    if (yield* fs.exists(projectFile).pipe(Effect.orElseSucceed(() => false))) return

    if (source !== undefined) return yield* copyProjectIdentity(repo, source)

    if (vercelProject !== undefined) {
      if (!(yield* gitSucceeds(repo, ["check-ignore", "-q", "--", ".vercel/project.json"]))) {
        return yield* fail(".vercel must be git-ignored before linking")
      }
      yield* Console.log(`provision-env: linking to Vercel project ${vercelProject}`)
      return yield* process.inherit("vercel", [
        "link",
        "--cwd",
        repo,
        "--project",
        vercelProject,
        "--yes",
        "--no-color"
      ])
    }

    const listed = yield* gitOutput(repo, ["worktree", "list", "--porcelain"])
    const candidates: Array<string> = []
    for (const line of listed.split("\n")) {
      if (!line.startsWith("worktree ")) continue
      const candidate = line.slice("worktree ".length)
      if (path.resolve(candidate) === repo) continue
      const linked = yield* fs.exists(path.join(candidate, ".vercel", "project.json")).pipe(
        Effect.orElseSucceed(() => false)
      )
      if (linked) candidates.push(candidate)
    }

    if (candidates.length > 0) {
      const identities = yield* Effect.forEach(candidates, (candidate) =>
        readVercelIdentity(path.join(candidate, ".vercel", "project.json"))
      )
      if (new Set(identities).size === 1) {
        return yield* copyProjectIdentity(repo, candidates[0]!)
      }
      return yield* fail(
        "linked sibling checkouts use different Vercel projects; pass --source explicitly"
      )
    }
    return yield* fail(
      "no Vercel project link found; link this checkout, pass --source, or pass --vercel-project"
    )
  })

const writePrivately = (file: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const temporary = `${file}.${process.pid}.provision-env.tmp`
    yield* fs.writeFileString(temporary, content).pipe(mapFileError(`cannot write ${file}`))
    yield* fs.chmod(temporary, 0o600).pipe(mapFileError(`cannot protect ${file}`))
    yield* fs.rename(temporary, file).pipe(mapFileError(`cannot replace ${file}`))
  })

const hasDatabaseUrls = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
    if (!exists) return false
    const content = yield* fs.readFileString(file).pipe(mapFileError(`cannot read ${file}`))
    const keys = new Set(
      content
        .split("\n")
        .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
        .map((line) => line.slice(0, line.indexOf("=")))
    )
    return keys.has("DATABASE_URL") && keys.has("DATABASE_URL_UNPOOLED")
  })

const LeaseStatusReport = Schema.parseJson(
  Schema.Struct({
    status: Schema.Union(
      Schema.Literal("live"),
      Schema.Literal("missing"),
      Schema.Literal("none")
    )
  })
)

const leaseIsLive = (repo: string, leaseName: string) =>
  Effect.gen(function* () {
    const process = yield* ProvisionProcess
    const result = yield* Effect.either(
      process.capture("sandbox-db", [
        "status",
        "--worktree",
        repo,
        "--lease",
        leaseName,
        "--json"
      ])
    )
    const output = Either.isRight(result) ? result.right.stdout : result.left.stdout
    if (output.trim().length === 0) {
      const detail = Either.isLeft(result) ? result.left.message : "empty status response"
      return yield* fail(`cannot verify ${leaseName} database lease: ${detail}`)
    }
    const report = yield* Schema.decodeUnknown(LeaseStatusReport)(output).pipe(
      Effect.mapError(
        (cause) =>
          new ProvisionError({
            message: `cannot verify ${leaseName} database lease: invalid status response: ${cause}`
          })
      )
    )
    return report.status === "live"
  })

const ensureNoLiveLeases = (repo: string) =>
  Effect.gen(function* () {
    const liveLeases: Array<string> = []
    if (yield* leaseIsLive(repo, "default")) liveLeases.push("default")
    if (yield* leaseIsLive(repo, "test")) liveLeases.push("test")
    if (liveLeases.length > 0) {
      return yield* fail(
        `cannot overwrite env files while ${liveLeases.join(" and ")} database lease${liveLeases.length === 1 ? " is" : "s are"} live; preserve the files or release the leases first`
      )
    }
  })

const ensureEnvUnchanged = (
  file: string,
  existed: boolean,
  snapshot: string | undefined
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
    if (exists !== existed) {
      return yield* fail(`${file} changed while provisioning; refusing to overwrite it`)
    }
    if (!exists) return
    const current = yield* fs.readFileString(file).pipe(
      mapFileError(`cannot revalidate ${file}`)
    )
    if (current !== snapshot) {
      return yield* fail(`${file} changed while provisioning; refusing to overwrite it`)
    }
  })

const releaseLease = (repo: string, leaseName: string) =>
  Effect.gen(function* () {
    const process = yield* ProvisionProcess
    yield* process.capture("sandbox-db", [
      "release",
      "--worktree",
      repo,
      "--lease",
      leaseName,
      "--json"
    ])
  })

const LeaseCreateReport = Schema.parseJson(
  Schema.Struct({
    status: Schema.Union(Schema.Literal("created"), Schema.Literal("reused")),
    branch_name: Schema.String,
    branch_id: Schema.String
  })
)

const createDatabaseLease = (
  repo: string,
  leaseName: "default" | "test",
  envFile: ".env.local" | ".env.test",
  label: string,
  ttl: string
) =>
  Effect.gen(function* () {
    const process = yield* ProvisionProcess
    const result = yield* process.capture("sandbox-db", [
      "create",
      "--worktree",
      repo,
      "--lease",
      leaseName,
      "--config-env-file",
      ".env.local",
      "--env-file",
      envFile,
      "--label",
      label,
      "--ttl",
      ttl,
      "--json"
    ])
    const parsed = yield* Schema.decodeUnknown(LeaseCreateReport)(result.stdout).pipe(
      Effect.mapError(
        (cause) =>
          new ProvisionError({ message: `invalid sandbox-db create response: ${cause}` })
      )
    )
    yield* Console.log(
      `provision-env: ${parsed.status} ${leaseName} lease ${parsed.branch_name} (${parsed.branch_id})`
    )
    return parsed.status
  })

const rollback = (
  repo: string,
  localEnvFile: string,
  testEnvFile: string,
  state: RollbackState
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    if (state.createdTestLease) yield* releaseLease(repo, "test")
    if (state.createdDefaultLease) yield* releaseLease(repo, "default")

    if (state.createdTestEnv) {
      if (state.testEnvSnapshot !== undefined) {
        yield* writePrivately(testEnvFile, state.testEnvSnapshot)
        yield* Console.error("provision-env: restored .env.test after setup failure")
      } else {
        yield* fs.remove(testEnvFile).pipe(mapFileError("cannot roll back .env.test"))
        yield* Console.error("provision-env: rolled back .env.test after setup failure")
      }
    }

    if (state.createdLocalEnv) {
      if (state.localEnvSnapshot !== undefined) {
        yield* writePrivately(localEnvFile, state.localEnvSnapshot)
        yield* Console.error("provision-env: restored .env.local after setup failure")
      } else {
        yield* fs.remove(localEnvFile).pipe(mapFileError("cannot roll back .env.local"))
        yield* Console.error("provision-env: rolled back .env.local after setup failure")
      }
    }

    for (const temporary of [state.testPullTemporary, state.localPullTemporary]) {
      if (temporary !== undefined) {
        yield* fs.remove(temporary).pipe(
          mapFileError(`cannot remove staged environment ${temporary}`)
        )
      }
    }
  })

const resolveEnvConflict = (
  policy: EnvConflictPolicy,
  nonInteractive: boolean,
  localExists: boolean,
  testExists: boolean
) =>
  Effect.gen(function* () {
    if (!localExists && !testExists) return "overwrite" as const
    const existing = [localExists ? ".env.local" : undefined, testExists ? ".env.test" : undefined]
      .filter((file): file is string => file !== undefined)
      .join(" and ")
    const bothExist = localExists && testExists
    const existence = bothExist ? "already exist" : "already exists"

    if (policy === "error") {
      return yield* fail(
        `${existing} ${existence}; use --env-conflict=preserve or --env-conflict=overwrite`
      )
    }
    if (policy === "preserve") {
      if (!bothExist) {
        return yield* fail(
          `cannot preserve a partial env pair (${existing}); use --env-conflict=overwrite or restore both files`
        )
      }
      return "preserve" as const
    }
    if (policy === "overwrite") return "overwrite" as const

    if (nonInteractive || process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
      return yield* fail(
        `${existing} ${existence} and prompting is unavailable; pass --env-conflict=preserve or --env-conflict=overwrite explicitly`
      )
    }

    return yield* Prompt.run(
      Prompt.select({
        message: `${existing} ${existence}. How should provision-env continue?`,
        choices: [
          {
            title: "Preserve existing env files",
            value: "preserve" as const,
            description: "Skip both Vercel pulls and continue with the existing files",
            disabled: !bothExist
          },
          {
            title: "Overwrite from Vercel",
            value: "overwrite" as const,
            description: "Snapshot both files, pull fresh values, and restore them if setup fails"
          },
          {
            title: "Cancel",
            value: "cancel" as const,
            description: "Exit without changing env files or database leases"
          }
        ]
      })
    ).pipe(
      Effect.mapError(() => new ProvisionError({ message: "cancelled by user" })),
      Effect.flatMap((decision) =>
        decision === "cancel"
          ? Effect.fail(new ProvisionError({ message: "cancelled by user" }))
          : Effect.succeed(decision)
      )
    )
  })

export const provisionEnvironment = (options: ProvisionOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const process = yield* ProvisionProcess
    const repo = yield* resolveCheckout(options.repo)
    const localEnvFile = path.join(repo, ".env.local")
    const testEnvFile = path.join(repo, ".env.test")
    const gitLockPath = yield* gitOutput(repo, ["rev-parse", "--git-path", "provision-env.lock"])
    const lockDirectory = path.resolve(repo, gitLockPath)
    yield* fs.makeDirectory(lockDirectory).pipe(
      Effect.mapError(
        () =>
          new ProvisionError({
            message: `another provision-env process is already using ${repo}; if none is running, remove stale lock ${lockDirectory}`
          })
      )
    )
    const state: RollbackState = {
      createdLocalEnv: false,
      createdTestEnv: false,
      createdDefaultLease: false,
      createdTestLease: false
    }

    const operation = Effect.gen(function* () {
      if (!options.skipVercel || options.database) {
        yield* ensureSecretPath(repo, ".env.local")
        yield* ensureSecretPath(repo, ".env.test")
      }

      const localEnvExists = yield* fs
        .exists(localEnvFile)
        .pipe(Effect.orElseSucceed(() => false))
      const testEnvExists = yield* fs
        .exists(testEnvFile)
        .pipe(Effect.orElseSucceed(() => false))
      const envDecision = options.skipVercel
        ? "preserve"
        : yield* resolveEnvConflict(
            options.envConflict,
            options.nonInteractive,
            localEnvExists,
            testEnvExists
          )
      const pullVercel = !options.skipVercel && envDecision === "overwrite"

      if (pullVercel && (localEnvExists || testEnvExists)) {
        yield* ensureNoLiveLeases(repo)
      }

      if (pullVercel && localEnvExists) {
        state.localEnvSnapshot = yield* fs.readFileString(localEnvFile).pipe(
          mapFileError("cannot snapshot existing .env.local")
        )
      }
      if (pullVercel && testEnvExists) {
        state.testEnvSnapshot = yield* fs.readFileString(testEnvFile).pipe(
          mapFileError("cannot snapshot existing .env.test")
        )
      }

      if (!options.skipInstall) yield* installDependencies(repo)

      if (pullVercel) {
        yield* ensureVercelLink(repo, options.source, options.vercelProject)
        const temporaryDirectory = path.join(repo, ".vercel")
        yield* fs.chmod(temporaryDirectory, 0o700).pipe(
          mapFileError("cannot protect Vercel staging directory")
        )
        const localPullTemporary = path.join(
          temporaryDirectory,
          ".env.local.provision-env.tmp"
        )
        const testPullTemporary = path.join(
          temporaryDirectory,
          ".env.test.provision-env.tmp"
        )
        state.localPullTemporary = localPullTemporary
        state.testPullTemporary = testPullTemporary
        yield* fs.remove(localPullTemporary).pipe(Effect.catchAll(() => Effect.void))
        yield* fs.remove(testPullTemporary).pipe(Effect.catchAll(() => Effect.void))
        yield* fs.writeFileString(localPullTemporary, "").pipe(
          mapFileError("cannot create Development staging file")
        )
        yield* fs.chmod(localPullTemporary, 0o600).pipe(
          mapFileError("cannot protect Development staging file")
        )
        yield* fs.writeFileString(testPullTemporary, "").pipe(
          mapFileError("cannot create test staging file")
        )
        yield* fs.chmod(testPullTemporary, 0o600).pipe(
          mapFileError("cannot protect test staging file")
        )

        const developmentExplicitKeys = yield* listExplicitVercelKeys(repo, "development")
        const testExplicitKeys = yield* listExplicitVercelKeys(repo, options.testEnvironment)

        yield* Console.log("provision-env: pulling Vercel Development variables into .env.local")
        yield* process.inherit("vercel", [
          "env",
          "pull",
          localPullTemporary,
          "--environment",
          "development",
          "--yes",
          "--cwd",
          repo,
          "--no-color"
        ])
        yield* sanitizePulledEnvironment(
          localPullTemporary,
          "Development",
          developmentExplicitKeys,
          options.database
        )
        yield* fs.chmod(localPullTemporary, 0o600).pipe(
          mapFileError("cannot protect pulled Development environment")
        )

        yield* Console.log(
          `provision-env: pulling Vercel ${options.testEnvironment} variables into .env.test`
        )
        yield* process.inherit("vercel", [
          "env",
          "pull",
          testPullTemporary,
          "--environment",
          options.testEnvironment,
          "--yes",
          "--cwd",
          repo,
          "--no-color"
        ])
        yield* sanitizePulledEnvironment(
          testPullTemporary,
          options.testEnvironment,
          testExplicitKeys,
          options.database
        )
        yield* fs.chmod(testPullTemporary, 0o600).pipe(
          mapFileError("cannot protect pulled test environment")
        )

        yield* ensureEnvUnchanged(localEnvFile, localEnvExists, state.localEnvSnapshot)
        yield* ensureEnvUnchanged(testEnvFile, testEnvExists, state.testEnvSnapshot)
        yield* ensureNoLiveLeases(repo)

        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            yield* fs.rename(localPullTemporary, localEnvFile).pipe(
              mapFileError("cannot publish .env.local")
            )
            state.localPullTemporary = undefined
            state.createdLocalEnv = true
            yield* fs.rename(testPullTemporary, testEnvFile).pipe(
              mapFileError("cannot publish .env.test")
            )
            state.testPullTemporary = undefined
            state.createdTestEnv = true
          })
        )
      }

      if (options.database) {
        if (!state.createdLocalEnv) {
          const exists = yield* fs.exists(localEnvFile).pipe(Effect.orElseSucceed(() => false))
          if (exists) {
            state.localEnvSnapshot = yield* fs.readFileString(localEnvFile).pipe(
              mapFileError("cannot snapshot .env.local")
            )
          }
        }
        if (!state.createdTestEnv) {
          const exists = yield* fs.exists(testEnvFile).pipe(Effect.orElseSucceed(() => false))
          if (exists) {
            state.testEnvSnapshot = yield* fs.readFileString(testEnvFile).pipe(
              mapFileError("cannot snapshot .env.test")
            )
          }
        }

        const defaultLeaseLive = yield* leaseIsLive(repo, "default")
        if (defaultLeaseLive && state.createdLocalEnv) {
          return yield* fail(
            "a live default database lease exists but .env.local was freshly pulled; release it before reprovisioning"
          )
        }
        if (defaultLeaseLive && !(yield* hasDatabaseUrls(localEnvFile))) {
          return yield* fail(
            "the live default database lease is missing URLs in .env.local; release it before reprovisioning"
          )
        }

        const testLeaseLive = yield* leaseIsLive(repo, "test")
        if (testLeaseLive && state.createdTestEnv) {
          return yield* fail(
            "a live test database lease exists but .env.test was freshly pulled; release it before reprovisioning"
          )
        }
        if (testLeaseLive && !(yield* hasDatabaseUrls(testEnvFile))) {
          return yield* fail(
            "the live test database lease is missing URLs in .env.test; release it before reprovisioning"
          )
        }

        const label =
          options.label ??
          (yield* gitOutput(repo, ["branch", "--show-current"]).pipe(
            Effect.map((branch) => branch || path.basename(repo))
          ))
        yield* Console.log("provision-env: allocating isolated development PostgreSQL")
        const defaultStatus = yield* createDatabaseLease(
          repo,
          "default",
          ".env.local",
          `${label}-development`,
          options.ttl
        )
        state.createdDefaultLease = defaultStatus === "created"
        if (defaultStatus === "created") state.createdLocalEnv = true

        yield* Console.log("provision-env: allocating isolated test PostgreSQL")
        const testStatus = yield* createDatabaseLease(
          repo,
          "test",
          ".env.test",
          `${label}-test`,
          options.ttl
        )
        state.createdTestLease = testStatus === "created"
        if (testStatus === "created") state.createdTestEnv = true
      }

      yield* Console.log("")
      yield* Console.log("provision-env: ready")
      yield* Console.log(`  repo:       ${repo}`)
      yield* Console.log(`  install:    ${options.skipInstall ? "skipped" : "complete"}`)
      yield* Console.log(
        `  vercel env: ${pullVercel ? ".env.local + .env.test" : options.skipVercel ? "skipped" : "preserved"}`
      )
      yield* Console.log(
        `  databases:  ${options.database ? "development + test ready" : "skipped"}`
      )
    })

    const withRollback = operation.pipe(
      Effect.catchAllCause((operationCause) =>
        rollback(repo, localEnvFile, testEnvFile, state).pipe(
          Effect.matchCauseEffect({
            onFailure: (rollbackCause) =>
              Effect.fail(
                new ProvisionError({
                  message:
                    `setup failed and rollback also failed:\n${Cause.pretty(operationCause)}\n` +
                    `rollback failure:\n${Cause.pretty(rollbackCause)}`
                })
              ),
            onSuccess: () => Effect.failCause(operationCause)
          })
        )
      )
    )
    const releaseLock = fs
      .remove(lockDirectory, { recursive: true })
      .pipe(mapFileError(`cannot release provision lock ${lockDirectory}`))

    return yield* withRollback.pipe(
      Effect.matchCauseEffect({
        onFailure: (operationCause) =>
          releaseLock.pipe(
            Effect.matchCauseEffect({
              onFailure: (lockCause) =>
                Effect.fail(
                  new ProvisionError({
                    message:
                      `operation failed and provision lock cleanup also failed:\n${Cause.pretty(operationCause)}\n` +
                      `lock cleanup failure:\n${Cause.pretty(lockCause)}`
                  })
                ),
              onSuccess: () => Effect.failCause(operationCause)
            })
          ),
        onSuccess: (value) => releaseLock.pipe(Effect.as(value))
      })
    )
  })
