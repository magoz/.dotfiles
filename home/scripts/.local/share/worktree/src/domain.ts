import { Data, Schema } from "effect"

export class WorktreeError extends Data.TaggedError("WorktreeError")<{
  readonly message: string
}> {}

export class ProcessError extends Data.TaggedError("ProcessError")<{
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

const WorkspaceInfo = Schema.Struct({
  workspace_id: Schema.String
})

const WorktreeInfo = Schema.Struct({
  path: Schema.String,
  branch: Schema.Union(Schema.String, Schema.Null)
})

export const WorktreeCreatedResponse = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("worktree_created"),
    workspace: WorkspaceInfo,
    worktree: WorktreeInfo
  })
})

const PaneInfo = Schema.Struct({
  pane_id: Schema.String,
  workspace_id: Schema.String,
  tab_id: Schema.String
})

export const PaneListResponse = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("pane_list"),
    panes: Schema.Array(PaneInfo)
  })
})

const AgentInfo = Schema.Struct({
  pane_id: Schema.String,
  workspace_id: Schema.String,
  interactive_ready: Schema.optional(Schema.Boolean),
  launch_pending: Schema.optional(Schema.Boolean),
  name: Schema.optional(Schema.Union(Schema.String, Schema.Null)),
  agent: Schema.optional(Schema.String),
  agent_status: Schema.optional(Schema.String)
})

export const AgentStartedResponse = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("agent_started"),
    agent: AgentInfo
  })
})

export const AgentInfoResponse = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("agent_info"),
    agent: AgentInfo
  })
})

export interface CreateOptions {
  readonly repo: string
  readonly branch: string
  readonly base?: string
  readonly path?: string
  readonly label?: string
  readonly ttl: string
  readonly prompt?: string
  readonly setupCommands: ReadonlyArray<string>
}

export interface CreatedEnvironment {
  readonly source: string
  readonly branch: string
  readonly base: string
  readonly path: string
  readonly workspaceId: string
  readonly paneId: string
  readonly agentName: string
  readonly warnings: ReadonlyArray<string>
}
