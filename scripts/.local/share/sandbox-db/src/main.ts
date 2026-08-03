#!/usr/bin/env bun
import { Command, Options, Prompt } from "@effect/cli"
import { Path } from "@effect/platform"
import { NodeContext, NodeHttpClient, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer, Option, Redacted } from "effect"
import { createHash, randomBytes } from "node:crypto"
import { loadConfig } from "./config"
import {
  API_KEY_ENV,
  clearSecret,
  readSecret,
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
  setExpiration,
  waitUntilReady
} from "./neon"
import { ensureIgnored, removeEnvKeys, resolveWorkspace, writeEnvKeys } from "./workspace"

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
      Options.withDescription("blank parent branch id (default: project default branch)"),
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

const authStatus = Command.make("status", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const secret = yield* readSecret
    const settings = yield* readSettings
    const location = yield* settingsLocation

    if (Option.isNone(secret)) {
      yield* report(json, {
        status: "unauthenticated",
        settings_file: location,
        note: `run: sandbox-db auth login (or set ${API_KEY_ENV})`
      })
      return yield* Effect.sync(() => {
        process.exitCode = 1
      })
    }

    const projectId = Option.getOrElse(settings.projectId, () => "")
    const verified = projectId.length > 0
      ? yield* describeProject({ apiKey: secret.value.value, projectId }).pipe(
          Effect.map((project) => `${project.name} (${project.id})`),
          Effect.orElseSucceed(() => "unverified")
        )
      : "not configured"

    yield* report(json, {
      status: verified === "unverified" ? "invalid" : "authenticated",
      backend: secret.value.backend,
      fingerprint: fingerprint(secret.value.value),
      project: verified,
      parent_branch: Option.getOrElse(settings.parentBranch, () => "not configured"),
      settings_file: location
    })
  })
)

const authLogout = Command.make("logout", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const removed = yield* clearSecret
    return yield* report(json, {
      status: removed.length > 0 ? "cleared" : "nothing-stored",
      backends: removed.join(", ") || "none",
      note: `an ${API_KEY_ENV} environment variable, if set, still applies`
    })
  })
)

const auth = Command.make("auth", {}, () =>
  Console.log("sandbox-db auth: use login, status or logout")
).pipe(
  Command.withDescription("Manage the stored Neon credential and sandbox settings."),
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
    envFile: Options.text("env-file").pipe(Options.withDefault(".env.local")),
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
  ({ envFile, forceNew, json, keys, label, noWait, ttl, worktree }) =>
    Effect.gen(function* () {
      const config = yield* loadConfig
      const path = yield* Path.Path
      const workspace = yield* resolveWorkspace(worktree)
      const envPath = path.resolve(workspace.root, envFile)

      const envKeys = keys.split(",").map((key) => key.trim()).filter((key) => key.length > 0)
      if (envKeys.length === 0) {
        return yield* Effect.fail(new PolicyError({ message: "--keys must name at least one variable" }))
      }

      yield* ensureIgnored(workspace.root, envPath)
      const ttlSeconds = yield* parseTtl(ttl)

      const existing = yield* readLease(workspace.root)
      if (Option.isSome(existing) && !forceNew) {
        const live = yield* getBranch(config, existing.value.branchId)
        if (Option.isSome(live)) {
          return yield* report(json, {
            status: "reused",
            branch_name: existing.value.branchName,
            branch_id: existing.value.branchId,
            expires_at: live.value.expires_at ?? "none",
            env_file: existing.value.envFile,
            note: "existing lease is still live; use renew to extend"
          })
        }
      }

      const shortLabel = slugify(Option.getOrElse(label, () => path.basename(workspace.root)))
      const repositoryName = slugify(workspace.repository.split("/").pop() ?? workspace.repository)
      const suffix = randomBytes(3).toString("hex")
      const branchName = `${BRANCH_PREFIX}${repositoryName}-${shortLabel}-${suffix}`
      const expiresAt = timestamp(ttlSeconds)

      const created = yield* createBranch(config, { name: branchName, expiresAt })

      yield* writeEnvKeys(
        envPath,
        envKeys.map(
          (key) =>
            [key, key.toUpperCase().endsWith("UNPOOLED") ? created.direct : created.pooled] as const
        )
      )

      const lease: Lease = {
        version: 1,
        projectId: config.projectId,
        parentBranch: config.parentBranch,
        branchId: created.branch.id,
        branchName: created.branch.name,
        worktree: workspace.root,
        repository: workspace.repository,
        label: shortLabel,
        envFile: envPath,
        envKeys,
        createdAt: timestamp(),
        expiresAt: created.branch.expires_at ?? expiresAt
      }
      yield* writeLease(lease)

      const state = noWait ? "not-checked" : yield* waitUntilReady(config, created.branch.id)

      return yield* report(json, {
        status: "created",
        branch_name: lease.branchName,
        branch_id: lease.branchId,
        state,
        expires_at: lease.expiresAt,
        env_file: lease.envFile,
        env_keys: envKeys.join(","),
        note: "connection string written to env file; not printed"
      })
    })
)

// ---------------------------------------------------------------------------
// status / renew / release
// ---------------------------------------------------------------------------

const status = Command.make(
  "status",
  { worktree: worktreeOption, json: jsonOption },
  ({ json, worktree }) =>
    Effect.gen(function* () {
      const config = yield* loadConfig
      const workspace = yield* resolveWorkspace(worktree)
      const lease = yield* readLease(workspace.root)

      if (Option.isNone(lease)) {
        yield* report(json, { status: "none", worktree: workspace.root })
        return yield* Effect.sync(() => {
          process.exitCode = 1
        })
      }

      const branch = yield* getBranch(config, lease.value.branchId)
      yield* report(json, {
        status: Option.isSome(branch) ? "live" : "missing",
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
  { worktree: worktreeOption, json: jsonOption, ttl: ttlOption("7d") },
  ({ json, ttl, worktree }) =>
    Effect.gen(function* () {
      const config = yield* loadConfig
      const workspace = yield* resolveWorkspace(worktree)
      const lease = yield* readLease(workspace.root)
      if (Option.isNone(lease)) {
        return yield* Effect.fail(
          new PolicyError({ message: `no lease recorded for ${workspace.root}` })
        )
      }

      const ttlSeconds = yield* parseTtl(ttl)
      const branch = yield* setExpiration(config, lease.value.branchId, timestamp(ttlSeconds))
      const updated: Lease = {
        ...lease.value,
        expiresAt: branch.expires_at ?? timestamp(ttlSeconds)
      }
      yield* writeLease(updated)

      return yield* report(json, {
        status: "renewed",
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
    keepEnv: Options.boolean("keep-env").pipe(
      Options.withDescription("leave env keys in place")
    )
  },
  ({ json, keepEnv, worktree }) =>
    Effect.gen(function* () {
      const config = yield* loadConfig
      const workspace = yield* resolveWorkspace(worktree)
      const lease = yield* readLease(workspace.root)
      if (Option.isNone(lease)) {
        return yield* report(json, { status: "none", worktree: workspace.root })
      }

      // Deletion guardrails: only this tool's own, non-default branches.
      if (!lease.value.branchName.startsWith(BRANCH_PREFIX)) {
        return yield* Effect.fail(
          new PolicyError({
            message: `refusing to delete ${lease.value.branchName}: missing ${BRANCH_PREFIX} prefix`
          })
        )
      }
      if (lease.value.projectId !== config.projectId) {
        return yield* Effect.fail(
          new PolicyError({ message: "refusing to delete: lease belongs to a different project" })
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
      yield* removeLease(workspace.root)

      return yield* report(json, {
        status: Option.isSome(branch) ? "released" : "already-gone",
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
      leases.map((lease) => `${lease.branchName}  ${lease.expiresAt}  ${lease.worktree}`).join("\n")
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
      const config = yield* loadConfig
      const leases = yield* allLeases
      const stale: Array<string> = []
      let live = 0

      for (const lease of leases) {
        const branch = yield* getBranch(config, lease.branchId)
        if (Option.isSome(branch)) {
          live += 1
          continue
        }
        stale.push(lease.branchName)
        if (!dryRun) yield* removeLease(lease.worktree)
      }

      return yield* report(json, {
        status: dryRun ? "dry-run" : "pruned",
        live_leases: live,
        stale_leases: stale.length,
        pruned: stale.join(", ") || "none"
      })
    })
)

// ---------------------------------------------------------------------------
// entrypoint
// ---------------------------------------------------------------------------

const root = Command.make("sandbox-db", {}, () =>
  Console.log("sandbox-db: run with --help to see available commands")
).pipe(
  Command.withDescription(
    "Provision ephemeral blank PostgreSQL branches for agent worktrees."
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


