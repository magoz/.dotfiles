import { Effect, Option, Redacted } from "effect"
import { readSecret, readSettings, type Backend } from "./credentials"
import { ConfigurationError } from "./domain"

export interface SandboxConfig {
  readonly apiKey: Redacted.Redacted<string>
  readonly projectId: string
  readonly parentBranch: string
  readonly backend: Backend
}

const missing = (what: string) =>
  new ConfigurationError({
    message: `${what}\nrun: sandbox-db auth login`
  })

/**
 * Resolution is deliberately explicit so `auth status` can report exactly
 * where each value came from.
 */
export const loadConfig = Effect.gen(function* () {
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
