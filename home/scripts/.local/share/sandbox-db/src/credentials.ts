import { Command, FileSystem, Path } from "@effect/platform"
import { Effect, Option, Redacted } from "effect"
import { ConfigurationError } from "./domain"

/**
 * Credential storage is an implementation detail behind `sandbox-db auth`.
 * Backends, in read precedence order:
 *
 *   1. environment  - explicit override, useful for CI or a parent process
 *   2. keychain     - encrypted at rest (macOS default)
 *   3. config file  - 0600 fallback for machines without a keychain
 */

const SERVICE = "sandbox-db"
const ACCOUNT = "neon-api-key"
export const API_KEY_ENV = "NEON_AGENTS_SANDBOX_API_KEY"

export type Backend = "environment" | "keychain" | "file"

export interface Settings {
  readonly projectId: Option.Option<string>
  readonly parentBranch: Option.Option<string>
}

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

const configHome = Effect.gen(function* () {
  const path = yield* Path.Path
  const home = process.env.HOME ?? ""
  const base = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config")
  return path.join(base, "pi")
})

const settingsFile = Effect.map(configHome, (dir) => `${dir}/sandbox-db.json`)
const legacyEnvFile = Effect.map(configHome, (dir) => `${dir}/sandbox-db.env`)

// ---------------------------------------------------------------------------
// keychain backend
// ---------------------------------------------------------------------------

const keychainAvailable = Effect.gen(function* () {
  if (process.platform !== "darwin") return false
  return yield* Command.exitCode(Command.make("which", "security")).pipe(
    Effect.map((code) => code === 0),
    Effect.orElseSucceed(() => false)
  )
})

const keychainRead = Command.string(
  Command.make("security", "find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w")
).pipe(
  Effect.map((value) => {
    const trimmed = value.trim()
    return trimmed.length > 0 ? Option.some(trimmed) : Option.none<string>()
  }),
  Effect.orElseSucceed(() => Option.none<string>())
)

/**
 * `security` takes the secret as an argument, so it is briefly visible in the
 * process table to this user. That is the same trust boundary as the 0600
 * file it replaces; the win is encryption at rest, not process isolation.
 */
const keychainWrite = (secret: string) =>
  Command.exitCode(
    Command.make(
      "security",
      "add-generic-password",
      "-s", SERVICE,
      "-a", ACCOUNT,
      "-w", secret,
      "-U",
      "-D", "sandbox-db neon api key"
    )
  ).pipe(
    Effect.flatMap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(new ConfigurationError({ message: `keychain write failed (exit ${code})` }))
    ),
    Effect.mapError((cause) =>
      cause instanceof ConfigurationError
        ? cause
        : new ConfigurationError({ message: `keychain unavailable: ${cause}` })
    )
  )

const keychainDelete = Command.exitCode(
  Command.make("security", "delete-generic-password", "-s", SERVICE, "-a", ACCOUNT)
).pipe(
  Effect.map((code) => code === 0),
  Effect.orElseSucceed(() => false)
)

// ---------------------------------------------------------------------------
// file backend
// ---------------------------------------------------------------------------

const parseEnvFile = (content: string): Map<string, string> => {
  const entries = new Map<string, string>()
  for (const raw of content.split("\n")) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith("#")) continue
    const index = line.indexOf("=")
    if (index <= 0) continue
    entries.set(
      line.slice(0, index).trim(),
      line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")
    )
  }
  return entries
}

const readEnvFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const file = yield* legacyEnvFile
  const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
  if (!exists) return new Map<string, string>()
  const content = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
  return parseEnvFile(content)
})

const writeEnvFile = (entries: Map<string, string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* configHome
    const file = yield* legacyEnvFile
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined))
    const body = [...entries].map(([key, value]) => `${key}=${value}`).join("\n")
    yield* fs.writeFileString(file, body.length > 0 ? `${body}\n` : "")
    yield* fs.chmod(file, 0o600).pipe(Effect.orElseSucceed(() => undefined))
  }).pipe(
    Effect.mapError((cause) => new ConfigurationError({ message: `config write failed: ${cause}` }))
  )

// ---------------------------------------------------------------------------
// secret api
// ---------------------------------------------------------------------------

export interface ResolvedSecret {
  readonly value: Redacted.Redacted<string>
  readonly backend: Backend
}

export const readSecret = Effect.gen(function* () {
  const fromEnv = process.env[API_KEY_ENV]
  if (fromEnv && fromEnv.trim().length > 0) {
    return Option.some<ResolvedSecret>({
      value: Redacted.make(fromEnv.trim()),
      backend: "environment"
    })
  }

  if (yield* keychainAvailable) {
    const stored = yield* keychainRead
    if (Option.isSome(stored)) {
      return Option.some<ResolvedSecret>({
        value: Redacted.make(stored.value),
        backend: "keychain"
      })
    }
  }

  const entries = yield* readEnvFile
  const fromFile = entries.get(API_KEY_ENV)
  if (fromFile && fromFile.length > 0) {
    return Option.some<ResolvedSecret>({ value: Redacted.make(fromFile), backend: "file" })
  }

  return Option.none<ResolvedSecret>()
})

export const storeSecret = (secret: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    if (yield* keychainAvailable) {
      yield* keychainWrite(Redacted.value(secret))
      // Do not leave an older plaintext copy behind once the keychain owns it.
      const entries = yield* readEnvFile
      if (entries.delete(API_KEY_ENV)) yield* writeEnvFile(entries)
      return "keychain" as Backend
    }
    const entries = yield* readEnvFile
    entries.set(API_KEY_ENV, Redacted.value(secret))
    yield* writeEnvFile(entries)
    return "file" as Backend
  })

export const clearSecret = Effect.gen(function* () {
  const removed: Array<Backend> = []
  if (yield* keychainAvailable) {
    if (yield* keychainDelete) removed.push("keychain")
  }
  const entries = yield* readEnvFile
  if (entries.delete(API_KEY_ENV)) {
    yield* writeEnvFile(entries)
    removed.push("file")
  }
  return removed
})

// ---------------------------------------------------------------------------
// non-secret settings
// ---------------------------------------------------------------------------

const PROJECT_ENV = "NEON_AGENTS_SANDBOX_PROJECT_ID"
const PARENT_ENV = "NEON_AGENTS_SANDBOX_PARENT_BRANCH"

export const readSettings = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const file = yield* settingsFile

  let stored: Record<string, unknown> = {}
  const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
  if (exists) {
    const content = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => "{}"))
    stored = yield* Effect.try(() => JSON.parse(content) as Record<string, unknown>).pipe(
      Effect.orElseSucceed(() => ({}) as Record<string, unknown>)
    )
  }

  const legacy = yield* readEnvFile
  const pick = (env: string, key: string) => {
    const fromEnv = process.env[env]
    if (fromEnv && fromEnv.trim().length > 0) return Option.some(fromEnv.trim())
    const fromStore = stored[key]
    if (typeof fromStore === "string" && fromStore.length > 0) return Option.some(fromStore)
    const fromLegacy = legacy.get(env)
    return fromLegacy && fromLegacy.length > 0 ? Option.some(fromLegacy) : Option.none<string>()
  }

  return {
    projectId: pick(PROJECT_ENV, "projectId"),
    parentBranch: pick(PARENT_ENV, "parentBranch")
  } satisfies Settings
})

export const writeSettings = (settings: { projectId: string; parentBranch: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* configHome
    const file = yield* settingsFile
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined))
    yield* fs.writeFileString(file, `${JSON.stringify(settings, null, 2)}\n`)
    yield* fs.chmod(file, 0o600).pipe(Effect.orElseSucceed(() => undefined))

    // Retire legacy plaintext settings now that the JSON store owns them.
    const entries = yield* readEnvFile
    const hadProject = entries.delete(PROJECT_ENV)
    const hadParent = entries.delete(PARENT_ENV)
    if (hadProject || hadParent) yield* writeEnvFile(entries)
  }).pipe(
    Effect.mapError((cause) => new ConfigurationError({ message: `settings write failed: ${cause}` }))
  )

export const settingsLocation = settingsFile
export const secretFileLocation = legacyEnvFile
