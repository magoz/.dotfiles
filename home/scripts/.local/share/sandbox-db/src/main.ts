#!/usr/bin/env bun
import { Command, Options, Prompt } from "@effect/cli"
import { FileSystem, Path } from "@effect/platform"
import { NodeContext, NodeHttpClient, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Either, Layer, Option, Redacted } from "effect"
import { createHash, randomBytes } from "node:crypto"
import { LOCAL_CONFIG_KEYS, loadConfig } from "./config"
import {
  API_KEY_ENV,
  clearSecret,
  readSettings,
  settingsLocation,
  storeSecret,
  writeSettings
} from "./credentials"
import { BRANCH_PREFIX, ConfigurationError, MAX_TTL_SECONDS, PolicyError, type Lease } from "./domain"
import { allLeases, readLease, removeLease, writeLease } from "./lease"
import {
  createBranch,
  deleteBranch,
  describeProject,
  findDefaultBranch,
  getBranch,
  getConnectionUris,
  setExpiration,
  waitUntilReady
} from "./neon"
import {
  ensureIgnored,
  hasEnvKeys,
  removeEnvKeys,
  resolveWorkspace,
  writeEnvKeys,
  writePrivately
} from "./workspace"

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const parseTtl = (value: string) =>
  Effect.gen(function* () {
    const match = /^(\d+)([smhd])$/.exec(value.trim().toLowerCase())
    if (!match) {
      return yield* Effect.fail(
        new PolicyError({ message: `invalid ttl ${value}; use forms like 12h, 3d, 90m` })
      )
    }
    const units = { s: 1, m: 60, h: 3600, d: 86400 } as const
    const seconds = Number(match[1]) * units[match[2] as keyof typeof units]
    if (seconds <= 0) {
      return yield* Effect.fail(new PolicyError({ message: "ttl must be positive" }))
    }
    if (seconds > MAX_TTL_SECONDS) {
      return yield* Effect.fail(
        new PolicyError({ message: `ttl exceeds policy maximum of ${MAX_TTL_SECONDS / 86400}d` })
      )
    }
    return seconds
  })

const timestamp = (offsetSeconds = 0) =>
  new Date(Date.now() + offsetSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")

const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "worktree"

const report = (json: boolean, payload: Record<string, string | number>) => {
  if (json) return Console.log(JSON.stringify(payload, null, 2))
  const width = Math.max(...Object.keys(payload).map((key) => key.length))
  const lines = Object.entries(payload).map(([key, value]) => `${key.padEnd(width)}  ${value}`)
  return Console.log(lines.join("\n"))
}

const localConfigKeys = new Set<string>(LOCAL_CONFIG_KEYS)

const ensureLeaseProfile = (
  config: { readonly projectId: string; readonly parentBranch: string },
  lease: Lease
) =>
  config.projectId !== lease.projectId
    ? Effect.fail(
        new PolicyError({
          message:
            `lease belongs to Neon project ${lease.projectId}, but the resolved profile selects ${config.projectId}\n` +
            "restore the original worktree environment before managing this lease"
        })
      )
    : config.parentBranch !== lease.parentBranch
      ? Effect.fail(
          new PolicyError({
            message:
              `lease belongs to parent branch ${lease.parentBranch}, but the resolved profile selects ${config.parentBranch}\n` +
              "release the existing lease before changing its parent branch"
          })
        )
      : Effect.void

// ---------------------------------------------------------------------------
// shared options
// ---------------------------------------------------------------------------

const worktreeOption = Options.text("worktree").pipe(
  Options.withDescription("worktree path (default: current directory)"),
  Options.optional
)
const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("machine-readable output")
)
const ttlOption = (fallback: string) =>
  Options.text("ttl").pipe(
    Options.withDescription(`lifetime such as 12h or 7d (default ${fallback})`),
    Options.withDefault(fallback)
  )
const leaseNameOption = Options.text("lease").pipe(
  Options.withDescription("lease slot within the worktree (default: default)"),
  Options.withDefault("default")
)

const validateLeaseName = (leaseName: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(leaseName)
    ? Effect.succeed(leaseName)
    : Effect.fail(
        new PolicyError({
          message: "--lease must be 1-64 letters, digits, dots, underscores, or hyphens"
        })
      )

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

/** Identifies which credential is in use without revealing any of it. */
const fingerprint = (secret: Redacted.Redacted<string>) =>
  createHash("sha256").update(Redacted.value(secret)).digest("hex").slice(0, 8)

const readStdin = Effect.promise(async () => {
  const chunks: Array<Buffer> = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8").trim()
})

const authLogin = Command.make(
  "login",
  {
    json: jsonOption,
    projectId: Options.text("project-id").pipe(
      Options.withDescription("neon sandbox project id"),
      Options.optional
    ),
    parentBranch: Options.text("parent-branch").pipe(
      Options.withDescription("parent branch id (default: project default branch)"),
      Options.optional
    ),
    tokenStdin: Options.boolean("token-stdin").pipe(
      Options.withDescription("read the api key from stdin instead of prompting")
    )
  },
  ({ json, parentBranch, projectId, tokenStdin }) =>
    Effect.gen(function* () {
      const existing = yield* readSettings

      // The credential is Redacted from the moment it is captured.
      const apiKey = tokenStdin
        ? Redacted.make((yield* readStdin).trim())
        : yield* Prompt.password({ message: "Neon API key (input hidden)" })
      if (Redacted.value(apiKey).trim().length === 0) {
        return yield* Effect.fail(new ConfigurationError({ message: "no api key provided" }))
      }

      const resolvedProject = Option.isSome(projectId)
        ? projectId.value
        : Option.isSome(existing.projectId)
          ? existing.projectId.value
          : yield* Prompt.text({ message: "Neon sandbox project id" })

      // Validate before persisting anything.
      const project = yield* describeProject({ apiKey, projectId: resolvedProject })

      const parent = Option.isSome(parentBranch)
        ? parentBranch.value
        : (yield* findDefaultBranch({ apiKey, projectId: resolvedProject })).id
      if (Option.isNone(yield* getBranch({ apiKey, projectId: resolvedProject }, parent))) {
        return yield* Effect.fail(
          new ConfigurationError({
            message: `parent branch ${parent} does not exist in project ${resolvedProject}`
          })
        )
      }

      const backend = yield* storeSecret(apiKey)
      yield* writeSettings({ projectId: project.id, parentBranch: parent })

      return yield* report(json, {
        status: "authenticated",
        backend,
        project: `${project.name} (${project.id})`,
        parent_branch: parent,
        fingerprint: fingerprint(apiKey),
        note: "credential stored; it is never printed"
      })
    })
)

const authStatus = Command.make(
  "status",
  { json: jsonOption, worktree: worktreeOption },
  ({ json, worktree }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const workspace = Option.isSome(worktree)
        ? Either.right(yield* resolveWorkspace(worktree))
        : yield* Effect.either(resolveWorkspace(Option.none()))
      const envFile = path.join(
        Either.isRight(workspace) ? workspace.right.root : path.resolve(process.cwd()),
        ".env.local"
      )
      const resolved = yield* Effect.either(loadConfig(envFile))

      if (Either.isLeft(resolved)) {
        yield* report(json, {
          status: "unauthenticated",
          settings_file: envFile,
          note: resolved.left.message
        })
        return yield* Effect.sync(() => {
          process.exitCode = 1
        })
      }

      const config = resolved.right
      const verification = yield* Effect.either(
        Effect.gen(function* () {
          const project = yield* describeProject(config)
          const parent = yield* getBranch(config, config.parentBranch)
          if (Option.isNone(parent)) {
            return yield* Effect.fail(
              new ConfigurationError({
                message:
                  `parent branch ${config.parentBranch} does not exist in project ${config.projectId}`
              })
            )
          }
          return project
        })
      )

      if (Either.isLeft(verification)) {
        yield* report(json, {
          status: "invalid",
          backend: config.backend,
          fingerprint: fingerprint(config.apiKey),
          project: config.projectId,
          parent_branch: `${config.parentBranch} (unverified)`,
          settings_file:
            config.backend === "worktree-env" ? envFile : yield* settingsLocation,
          note: verification.left.message
        })
        return yield* Effect.sync(() => {
          process.exitCode = 1
        })
      }

      yield* report(json, {
        status: "authenticated",
        backend: config.backend,
        fingerprint: fingerprint(config.apiKey),
        project: `${verification.right.name} (${verification.right.id})`,
        parent_branch: config.parentBranch,
        settings_file:
          config.backend === "worktree-env" ? envFile : yield* settingsLocation
      })
    })
)

const authLogout = Command.make("logout", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const removed = yield* clearSecret
    return yield* report(json, {
      status: removed.length > 0 ? "cleared" : "nothing-stored",
      backends: removed.join(", ") || "none",
      note:
        `an ${API_KEY_ENV} environment variable or complete worktree .env.local profile, if set, still applies`
    })
  })
)

const auth = Command.make("auth", {}, () =>
  Console.log("sandbox-db auth: use login, status or logout")
).pipe(
  Command.withDescription("Manage global Neon auth and inspect resolved worktree auth."),
  Command.withSubcommands([authLogin, authStatus, authLogout])
)

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

const create = Command.make(
  "create",
  {
    worktree: worktreeOption,
    json: jsonOption,
    ttl: ttlOption("7d"),
    label: Options.text("label").pipe(
      Options.withDescription("short label, e.g. issue-4"),
      Options.optional
    ),
    envFile: Options.text("env-file").pipe(
      Options.withDescription("env file that receives database URLs"),
      Options.withDefault(".env.local")
    ),
    configEnvFile: Options.text("config-env-file").pipe(
      Options.withDescription("env file containing the sandbox database profile (default: --env-file)"),
      Options.optional
    ),
    leaseName: leaseNameOption,
    keys: Options.text("keys").pipe(
      Options.withDefault("DATABASE_URL,DATABASE_URL_UNPOOLED")
    ),
    forceNew: Options.boolean("force-new").pipe(
      Options.withDescription("ignore any existing lease")
    ),
    noWait: Options.boolean("no-wait").pipe(
      Options.withDescription("do not wait for the branch to become ready")
    )
  },
  ({ configEnvFile, envFile, forceNew, json, keys, label, leaseName, noWait, ttl, worktree }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const workspace = yield* resolveWorkspace(worktree)
      const validatedLeaseName = yield* validateLeaseName(leaseName)
      const envPath = path.resolve(workspace.root, envFile)
      const configEnvPath = path.resolve(
        workspace.root,
        Option.getOrElse(configEnvFile, () => envFile)
      )
      const config = yield* loadConfig(configEnvPath)

      const envKeys = keys.split(",").map((key) => key.trim()).filter((key) => key.length > 0)
      if (envKeys.length === 0) {
        return yield* Effect.fail(new PolicyError({ message: "--keys must name at least one variable" }))
      }
      const invalid = envKeys.filter((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      if (invalid.length > 0) {
        return yield* Effect.fail(
          new PolicyError({ message: `--keys contains invalid environment names: ${invalid.join(", ")}` })
        )
      }
      const duplicates = envKeys.filter((key, index) => envKeys.indexOf(key) !== index)
      if (duplicates.length > 0) {
        return yield* Effect.fail(
          new PolicyError({ message: `--keys contains duplicates: ${[...new Set(duplicates)].join(", ")}` })
        )
      }
      const reserved = envKeys.filter((key) => localConfigKeys.has(key))
      if (reserved.length > 0) {
        return yield* Effect.fail(
          new PolicyError({
            message: `--keys cannot overwrite sandbox configuration: ${reserved.join(", ")}`
          })
        )
      }

      yield* ensureIgnored(workspace.root, envPath)
      const ttlSeconds = yield* parseTtl(ttl)

      const existing = yield* readLease(workspace.root, validatedLeaseName)
      if (Option.isSome(existing) && !forceNew) {
        const sameKeys =
          existing.value.envKeys.length === envKeys.length &&
          existing.value.envKeys.every((key, index) => key === envKeys[index])
        const sameProfile =
          existing.value.projectId === config.projectId &&
          existing.value.parentBranch === config.parentBranch
        const sameTarget =
          existing.value.envFile === envPath &&
          existing.value.configEnvFile === configEnvPath &&
          sameKeys
        const completeConnectionMetadata =
          (existing.value.databaseName === undefined) ===
          (existing.value.roleName === undefined)

        if (sameProfile && sameTarget && completeConnectionMetadata) {
          const live = yield* getBranch(config, existing.value.branchId)
          if (Option.isSome(live)) {
            if (!(yield* hasEnvKeys(existing.value.envFile, existing.value.envKeys))) {
              const databaseName = existing.value.databaseName
              const roleName = existing.value.roleName
              const connection = yield* Effect.option(
                getConnectionUris(
                  config,
                  existing.value.branchId,
                  databaseName !== undefined && roleName !== undefined
                    ? { databaseName, roleName }
                    : undefined
                )
              )
              if (Option.isSome(connection)) {
                const requestedExpiration = timestamp(ttlSeconds)
                const refreshed = yield* Effect.option(
                  setExpiration(config, existing.value.branchId, requestedExpiration)
                )
                if (Option.isSome(refreshed)) {
                  const refreshedExpiration =
                    refreshed.value.expires_at ?? requestedExpiration
                  yield* writeEnvKeys(
                    existing.value.envFile,
                    existing.value.envKeys.map(
                      (key) =>
                        [
                          key,
                          key.toUpperCase().endsWith("UNPOOLED")
                            ? connection.value.direct
                            : connection.value.pooled
                        ] as const
                    )
                  )
                  yield* writeLease({
                    ...existing.value,
                    databaseName: connection.value.databaseName,
                    roleName: connection.value.roleName,
                    expiresAt: refreshedExpiration
                  })
                  return yield* report(json, {
                    status: "reused",
                    lease: existing.value.leaseName,
                    branch_name: existing.value.branchName,
                    branch_id: existing.value.branchId,
                    expires_at: refreshedExpiration,
                    config_env_file: existing.value.configEnvFile,
                    env_file: existing.value.envFile,
                    note: "restored missing connection URLs for the existing live lease"
                  })
                }
                yield* Console.error(
                  `sandbox-db: could not extend ${validatedLeaseName} lease; creating a replacement`
                )
              } else {
                yield* Console.error(
                  `sandbox-db: could not restore ${validatedLeaseName} lease URLs; creating a replacement`
                )
              }
            } else {
              const requestedExpiration = timestamp(ttlSeconds)
              const refreshed = yield* Effect.option(
                setExpiration(config, existing.value.branchId, requestedExpiration)
              )
              if (Option.isSome(refreshed)) {
                const refreshedExpiration =
                  refreshed.value.expires_at ?? requestedExpiration
                yield* writeLease({ ...existing.value, expiresAt: refreshedExpiration })
                return yield* report(json, {
                  status: "reused",
                  lease: existing.value.leaseName,
                  branch_name: existing.value.branchName,
                  branch_id: existing.value.branchId,
                  expires_at: refreshedExpiration,
                  config_env_file: existing.value.configEnvFile,
                  env_file: existing.value.envFile,
                  note: "existing lease is still live and its TTL was refreshed"
                })
              }
              yield* Console.error(
                `sandbox-db: could not extend ${validatedLeaseName} lease; creating a replacement`
              )
            }
          }
        } else {
          yield* Console.error(
            `sandbox-db: ignoring stale ${validatedLeaseName} lease record; its branch will expire automatically`
          )
        }
      }

      const shortLabel = slugify(Option.getOrElse(label, () => path.basename(workspace.root)))
      const repositoryName = slugify(workspace.repository.split("/").pop() ?? workspace.repository)
      const suffix = randomBytes(3).toString("hex")
      const branchName = `${BRANCH_PREFIX}${repositoryName}-${shortLabel}-${suffix}`
      const expiresAt = timestamp(ttlSeconds)
      const envExisted = yield* fs.exists(envPath).pipe(Effect.orElseSucceed(() => false))
      const previousEnv = envExisted
        ? yield* fs.readFileString(envPath).pipe(
            Effect.mapError(
              (cause) => new PolicyError({ message: `cannot snapshot ${envPath}: ${cause}` })
            )
          )
        : undefined

      const created = yield* createBranch(config, { name: branchName, expiresAt })
      const lease: Lease = {
        version: 2,
        leaseName: validatedLeaseName,
        projectId: config.projectId,
        parentBranch: config.parentBranch,
        branchId: created.branch.id,
        branchName: created.branch.name,
        worktree: workspace.root,
        repository: workspace.repository,
        label: shortLabel,
        configEnvFile: configEnvPath,
        envFile: envPath,
        envKeys,
        databaseName: created.databaseName,
        roleName: created.roleName,
        createdAt: timestamp(),
        expiresAt: created.branch.expires_at ?? expiresAt
      }
      let envWritten = false
      let leaseWritten = false

      return yield* Effect.gen(function* () {
        yield* writeEnvKeys(
          envPath,
          envKeys.map(
            (key) =>
              [
                key,
                key.toUpperCase().endsWith("UNPOOLED") ? created.direct : created.pooled
              ] as const
          )
        )
        envWritten = true
        yield* writeLease(lease)
        leaseWritten = true

        const state = noWait ? "not-checked" : yield* waitUntilReady(config, created.branch.id)

        return yield* report(json, {
          status: "created",
          lease: lease.leaseName,
          branch_name: lease.branchName,
          branch_id: lease.branchId,
          state,
          expires_at: lease.expiresAt,
          env_file: lease.envFile,
          env_keys: envKeys.join(","),
          config_source: config.backend,
          config_env_file: lease.configEnvFile,
          parent_branch: config.parentBranch,
          note: "connection string written to env file; not printed"
        })
      }).pipe(
        Effect.onError(() =>
          Effect.gen(function* () {
            yield* deleteBranch(config, created.branch.id).pipe(Effect.catchAll(() => Effect.void))
            if (envWritten) {
              if (previousEnv !== undefined) {
                yield* writePrivately(envPath, previousEnv).pipe(
                  Effect.catchAll(() => Effect.void)
                )
              } else {
                yield* fs.remove(envPath).pipe(Effect.catchAll(() => Effect.void))
              }
            }
            if (leaseWritten) {
              yield* removeLease(workspace.root, validatedLeaseName).pipe(
                Effect.catchAll(() => Effect.void)
              )
            }
          })
        )
      )
    })
)

// ---------------------------------------------------------------------------
// status / renew / release
// ---------------------------------------------------------------------------

const status = Command.make(
  "status",
  { worktree: worktreeOption, json: jsonOption, leaseName: leaseNameOption },
  ({ json, leaseName, worktree }) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(worktree)
      const validatedLeaseName = yield* validateLeaseName(leaseName)
      const lease = yield* readLease(workspace.root, validatedLeaseName)

      if (Option.isNone(lease)) {
        yield* report(json, { status: "none", lease: validatedLeaseName, worktree: workspace.root })
        return yield* Effect.sync(() => {
          process.exitCode = 1
        })
      }

      const config = yield* loadConfig(lease.value.configEnvFile)
      yield* ensureLeaseProfile(config, lease.value)
      const branch = yield* getBranch(config, lease.value.branchId)
      yield* report(json, {
        status: Option.isSome(branch) ? "live" : "missing",
        lease: lease.value.leaseName,
        branch_name: lease.value.branchName,
        branch_id: lease.value.branchId,
        state: Option.match(branch, {
          onNone: () => "gone",
          onSome: (value) => value.current_state ?? "unknown"
        }),
        expires_at: Option.match(branch, {
          onNone: () => lease.value.expiresAt,
          onSome: (value) => value.expires_at ?? lease.value.expiresAt
        }),
        repository: lease.value.repository,
        parent_branch: lease.value.parentBranch,
        config_source: config.backend,
        config_env_file: lease.value.configEnvFile,
        env_file: lease.value.envFile,
        worktree: lease.value.worktree
      })

      if (Option.isNone(branch)) {
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
      }
    })
)

const renew = Command.make(
  "renew",
  { worktree: worktreeOption, json: jsonOption, leaseName: leaseNameOption, ttl: ttlOption("7d") },
  ({ json, leaseName, ttl, worktree }) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(worktree)
      const validatedLeaseName = yield* validateLeaseName(leaseName)
      const lease = yield* readLease(workspace.root, validatedLeaseName)
      if (Option.isNone(lease)) {
        return yield* Effect.fail(
          new PolicyError({
            message: `no ${validatedLeaseName} lease recorded for ${workspace.root}`
          })
        )
      }

      const config = yield* loadConfig(lease.value.configEnvFile)
      yield* ensureLeaseProfile(config, lease.value)
      const ttlSeconds = yield* parseTtl(ttl)
      const branch = yield* setExpiration(config, lease.value.branchId, timestamp(ttlSeconds))
      const updated: Lease = {
        ...lease.value,
        expiresAt: branch.expires_at ?? timestamp(ttlSeconds)
      }
      yield* writeLease(updated)

      return yield* report(json, {
        status: "renewed",
        lease: updated.leaseName,
        branch_name: updated.branchName,
        branch_id: updated.branchId,
        expires_at: updated.expiresAt
      })
    })
)

const release = Command.make(
  "release",
  {
    worktree: worktreeOption,
    json: jsonOption,
    leaseName: leaseNameOption,
    keepEnv: Options.boolean("keep-env").pipe(
      Options.withDescription("leave env keys in place")
    )
  },
  ({ json, keepEnv, leaseName, worktree }) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(worktree)
      const validatedLeaseName = yield* validateLeaseName(leaseName)
      const lease = yield* readLease(workspace.root, validatedLeaseName)
      if (Option.isNone(lease)) {
        return yield* report(json, {
          status: "none",
          lease: validatedLeaseName,
          worktree: workspace.root
        })
      }

      const config = yield* loadConfig(lease.value.configEnvFile)
      yield* ensureLeaseProfile(config, lease.value)

      // Deletion guardrails: only this tool's own, non-default branches.
      if (!lease.value.branchName.startsWith(BRANCH_PREFIX)) {
        return yield* Effect.fail(
          new PolicyError({
            message: `refusing to delete ${lease.value.branchName}: missing ${BRANCH_PREFIX} prefix`
          })
        )
      }
      const branch = yield* getBranch(config, lease.value.branchId)
      if (Option.isSome(branch)) {
        if (branch.value.default === true) {
          return yield* Effect.fail(
            new PolicyError({ message: "refusing to delete the project default branch" })
          )
        }
        if (branch.value.protected === true) {
          return yield* Effect.fail(
            new PolicyError({ message: "refusing to delete a protected branch" })
          )
        }
        yield* deleteBranch(config, lease.value.branchId)
      }

      if (!keepEnv) {
        yield* removeEnvKeys(lease.value.envFile, lease.value.envKeys)
      }
      yield* removeLease(workspace.root, lease.value.leaseName)

      return yield* report(json, {
        status: Option.isSome(branch) ? "released" : "already-gone",
        lease: lease.value.leaseName,
        branch_name: lease.value.branchName,
        branch_id: lease.value.branchId,
        env_keys_removed: keepEnv ? "no" : "yes"
      })
    })
)

// ---------------------------------------------------------------------------
// list / gc
// ---------------------------------------------------------------------------

const list = Command.make("list", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const leases = yield* allLeases
    if (json) return yield* Console.log(JSON.stringify(leases, null, 2))
    if (leases.length === 0) return yield* Console.log("no leases")
    return yield* Console.log(
      leases
        .map(
          (lease) =>
            `${lease.leaseName}  ${lease.branchName}  ${lease.expiresAt}  ${lease.worktree}`
        )
        .join("\n")
    )
  })
)

const gc = Command.make(
  "gc",
  {
    json: jsonOption,
    dryRun: Options.boolean("dry-run").pipe(
      Options.withDescription("report without removing lease records")
    )
  },
  ({ dryRun, json }) =>
    Effect.gen(function* () {
      const leases = yield* allLeases
      const stale: Array<string> = []
      const inaccessible: Array<string> = []
      let live = 0

      for (const lease of leases) {
        const resolved = yield* Effect.either(loadConfig(lease.configEnvFile))
        if (
          Either.isLeft(resolved) ||
          resolved.right.projectId !== lease.projectId ||
          resolved.right.parentBranch !== lease.parentBranch
        ) {
          inaccessible.push(lease.branchName)
          continue
        }

        const lookedUp = yield* Effect.either(getBranch(resolved.right, lease.branchId))
        if (Either.isLeft(lookedUp)) {
          inaccessible.push(lease.branchName)
          continue
        }
        if (Option.isSome(lookedUp.right)) {
          live += 1
          continue
        }
        stale.push(lease.branchName)
        if (!dryRun) yield* removeLease(lease.worktree, lease.leaseName)
      }

      yield* report(json, {
        status: inaccessible.length > 0 ? "partial" : dryRun ? "dry-run" : "pruned",
        live_leases: live,
        stale_leases: stale.length,
        inaccessible_leases: inaccessible.length,
        pruned: stale.join(", ") || "none",
        inaccessible: inaccessible.join(", ") || "none"
      })
      if (inaccessible.length > 0) {
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
      }
    })
)

// ---------------------------------------------------------------------------
// entrypoint
// ---------------------------------------------------------------------------

const root = Command.make("sandbox-db", {}, () =>
  Console.log("sandbox-db: run with --help to see available commands")
).pipe(
  Command.withDescription(
    "Provision ephemeral PostgreSQL branches for agent worktrees.\n\n" +
    "Documentation: ~/.local/share/sandbox-db/README.md"
  ),
  Command.withSubcommands([auth, create, status, renew, release, list, gc])
)

const cli = Command.run(root, { name: "sandbox-db", version: "1.0.0" })

const MainLayer = Layer.mergeAll(NodeContext.layer, NodeHttpClient.layer)

Effect.suspend(() => cli(process.argv)).pipe(
  Effect.catchTags({
    ConfigurationError: (error) => failWith(error.message),
    PolicyError: (error) => failWith(error.message),
    WorkspaceError: (error) => failWith(error.message),
    NeonError: (error) => failWith(error.message),
    LeaseError: (error) => failWith(error.message)
  }),
  Effect.provide(MainLayer),
  NodeRuntime.runMain
)

function failWith(message: string) {
  return Console.error(`sandbox-db: ${message}`).pipe(
    Effect.zipRight(
      Effect.sync(() => {
        process.exitCode = 2
      })
    )
  )
}


