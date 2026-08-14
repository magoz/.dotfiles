import { Data } from "effect"

export class ProvisionError extends Data.TaggedError("ProvisionError")<{
  readonly message: string
}> {}

export class ProvisionProcessError extends Data.TaggedError("ProvisionProcessError")<{
  readonly command: string
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}> {
  get message() {
    const detail = this.stderr.trim() || this.stdout.trim()
    return detail.length > 0
      ? `${this.command}: ${detail}`
      : `${this.command}: exited with ${this.exitCode ?? "an unknown status"}`
  }
}

export type EnvConflictPolicy = "ask" | "error" | "overwrite" | "preserve"

export interface ProvisionOptions {
  readonly repo: string
  readonly source?: string
  readonly vercelProject?: string
  readonly database: boolean
  readonly testEnvironment: string
  readonly label?: string
  readonly ttl: string
  readonly skipInstall: boolean
  readonly skipVercel: boolean
  readonly nonInteractive: boolean
  readonly envConflict: EnvConflictPolicy
}
