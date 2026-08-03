import { Data, Schema } from "effect"

/** Policy: leases are short-lived by construction. */
export const BRANCH_PREFIX = "agent/"
export const MAX_TTL_SECONDS = 7 * 24 * 3600
export const SUSPEND_TIMEOUT_SECONDS = 300
export const READY_TIMEOUT_SECONDS = 90

export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly message: string
}> {}

export class PolicyError extends Data.TaggedError("PolicyError")<{
  readonly message: string
}> {}

export class WorkspaceError extends Data.TaggedError("WorkspaceError")<{
  readonly message: string
}> {}

export class NeonError extends Data.TaggedError("NeonError")<{
  readonly message: string
}> {}

export class LeaseError extends Data.TaggedError("LeaseError")<{
  readonly message: string
}> {}

export type SandboxError =
  | ConfigurationError
  | PolicyError
  | WorkspaceError
  | NeonError
  | LeaseError

/** Neon branch, narrowed to the fields this tool relies on. */
export const Branch = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  parent_id: Schema.optional(Schema.String),
  current_state: Schema.optional(Schema.String),
  default: Schema.optional(Schema.Boolean),
  protected: Schema.optional(Schema.Boolean),
  expires_at: Schema.optional(Schema.String),
  ttl_interval_seconds: Schema.optional(Schema.Number)
})
export type Branch = Schema.Schema.Type<typeof Branch>

/**
 * Connection material stays `Redacted` end to end. It is unwrapped only at the
 * single boundary that writes the worktree env file.
 */
export const ConnectionUri = Schema.Struct({
  connection_uri: Schema.Redacted(Schema.String),
  connection_parameters: Schema.optional(
    Schema.Struct({
      database: Schema.optional(Schema.String),
      role: Schema.optional(Schema.String),
      host: Schema.optional(Schema.String),
      pooler_host: Schema.optional(Schema.String)
    })
  )
})

export const BranchResponse = Schema.Struct({ branch: Branch })

export const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String
})

export const ProjectResponse = Schema.Struct({ project: Project })

export const CreateBranchResponse = Schema.Struct({
  branch: Branch,
  connection_uris: Schema.optional(Schema.Array(ConnectionUri))
})

export const BranchListResponse = Schema.Struct({
  branches: Schema.Array(Branch)
})

/** Lease records are persisted outside the repository and hold no secrets. */
export const Lease = Schema.Struct({
  version: Schema.Literal(1),
  projectId: Schema.String,
  parentBranch: Schema.String,
  branchId: Schema.String,
  branchName: Schema.String,
  worktree: Schema.String,
  repository: Schema.String,
  label: Schema.String,
  envFile: Schema.String,
  envKeys: Schema.Array(Schema.String),
  createdAt: Schema.String,
  expiresAt: Schema.String
})
export type Lease = Schema.Schema.Type<typeof Lease>

export const LeaseFromJson = Schema.parseJson(Lease)
