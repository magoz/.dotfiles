import { FileSystem } from "@effect/platform"
import { Effect, Option, Redacted } from "effect"
import { readSecret, readSettings, type Backend } from "./credentials"
import { ConfigurationError } from "./domain"

export const LOCAL_API_KEY_ENV = "SANDBOX_DB_NEON_API_KEY"
export const LOCAL_PROJECT_ENV = "SANDBOX_DB_NEON_PROJECT_ID"
export const LOCAL_PARENT_ENV = "SANDBOX_DB_PARENT_BRANCH_ID"

export type ConfigBackend = Backend | "worktree-env"

export interface SandboxConfig {
  readonly apiKey: Redacted.Redacted<string>
  readonly projectId: string
  readonly parentBranch: string
  readonly backend: ConfigBackend
}

export const LOCAL_CONFIG_KEYS = [
  LOCAL_API_KEY_ENV,
  LOCAL_PROJECT_ENV,
  LOCAL_PARENT_ENV
] as const

const missing = (what: string) =>
  new ConfigurationError({
    message:
      `${what}\n` +
      "run: sandbox-db auth login, or configure the worktree's Vercel Development environment"
  })

const parseEnvFile = (content: string) => {
  const entries = new Map<string, string>()
  for (const raw of content.split("\n")) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith("#")) continue
    const index = line.indexOf("=")
    if (index <= 0) continue

    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    entries.set(key, value)
  }
  return entries
}

/**
 * A worktree profile is atomic: once any local key is present, all three must
 * be present. This prevents accidentally combining one account's credential
 * with another account's globally configured project.
 */
const readWorktreeConfig = (envFile: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* fs.exists(envFile).pipe(
      Effect.mapError(
        (cause) =>
          new ConfigurationError({ message: `cannot inspect local environment ${envFile}: ${cause}` })
      )
    )
    if (!exists) return Option.none<SandboxConfig>()

    const content = yield* fs.readFileString(envFile).pipe(
      Effect.mapError(
        (cause) =>
          new ConfigurationError({ message: `cannot read local environment ${envFile}: ${cause}` })
      )
    )
    const entries = parseEnvFile(content)
    const declared = LOCAL_CONFIG_KEYS.filter((key) => entries.has(key))
    if (declared.length === 0) return Option.none<SandboxConfig>()

    const absent = LOCAL_CONFIG_KEYS.filter((key) => !entries.has(key))
    const empty = LOCAL_CONFIG_KEYS.filter(
      (key) => entries.has(key) && entries.get(key)!.trim().length === 0
    )
    if (absent.length > 0 || empty.length > 0) {
      const details = [
        absent.length > 0 ? `missing ${absent.join(", ")}` : "",
        empty.length > 0 ? `empty ${empty.join(", ")}` : ""
      ].filter((value) => value.length > 0).join("; ")
      return yield* Effect.fail(
        new ConfigurationError({
          message:
            `incomplete sandbox database profile in ${envFile}; ${details}\n` +
            "local profiles are not combined with global authentication"
        })
      )
    }

    return Option.some<SandboxConfig>({
      apiKey: Redacted.make(entries.get(LOCAL_API_KEY_ENV)!.trim()),
      projectId: entries.get(LOCAL_PROJECT_ENV)!.trim(),
      parentBranch: entries.get(LOCAL_PARENT_ENV)!.trim(),
      backend: "worktree-env"
    })
  })

/**
 * Resolve one complete credential/project/parent tuple. A complete profile in
 * the worktree env takes precedence; otherwise the existing global auth is
 * used as a backwards-compatible fallback.
 */
export const loadConfig = (envFile?: string) =>
  Effect.gen(function* () {
    if (envFile !== undefined) {
      const local = yield* readWorktreeConfig(envFile)
      if (Option.isSome(local)) return local.value
    }

    const secret = yield* readSecret
    if (Option.isNone(secret)) {
      return yield* Effect.fail(missing("no neon api key configured"))
    }

    const settings = yield* readSettings
    if (Option.isNone(settings.projectId)) {
      return yield* Effect.fail(missing("no sandbox project configured"))
    }
    if (Option.isNone(settings.parentBranch)) {
      return yield* Effect.fail(missing("no parent branch configured"))
    }

    return {
      apiKey: secret.value.value,
      projectId: settings.projectId.value,
      parentBranch: settings.parentBranch.value,
      backend: secret.value.backend
    } satisfies SandboxConfig
  })
