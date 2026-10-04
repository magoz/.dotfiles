// Shared server/TUI contract for the `create_worktree` handoff: Effect Schemas for the tool, the
// pane bridge RPC and the worktree CLI's results. The host validates with the `portable` forms
// (see ../shared/portable.ts); the TUI and pane code decode with the exact decoders below.
import { Schema } from "effect"
import { portable } from "../shared/portable.ts"

export const MAX_TEXT = 16_384
/** Non-empty, bounded, no NUL: values end up as CLI argv. */
export const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_TEXT), Schema.makeFilter((value) => !value.includes("\0")))

/** Model-facing tool input. Repo/cwd are deliberately absent: the server resolves them. */
export const WorktreeInput = Schema.Struct({
  branch: Schema.optionalKey(Text),
  base: Schema.optionalKey(Text),
  path: Schema.optionalKey(Text),
  label: Schema.optionalKey(Text),
  ttl: Schema.optionalKey(Text),
  prompt: Schema.optionalKey(Text),
  setup: Schema.optionalKey(Schema.Array(Text).check(Schema.isMaxLength(16))),
})
export type WorktreeInput = typeof WorktreeInput.Type
/** Input after branch inference: `branch` is always present. */
export type ResolvedInput = WorktreeInput & { readonly branch: string }

/** Exact `worktree create --json` success object; `agentKind` must be OpenCode. */
export const Destination = Schema.Struct({
  source: Text,
  branch: Text,
  base: Text,
  path: Text,
  workspaceId: Text,
  paneId: Text,
  agentName: Text,
  agentKind: Schema.Literal("opencode"),
  warnings: Schema.Array(Text).check(Schema.isMaxLength(64)),
})
export type Destination = typeof Destination.Type

/** `provision-env --check-vercel-link` exit-3 report. */
export const Link = Schema.Struct({ status: Schema.Literal("vercel_link_required"), directory: Text, reason: Text })
export type Link = typeof Link.Type

const Ready = Schema.Struct({ status: Schema.Literal("ready"), destination: Destination, sourceRetained: Schema.Literal(true) })
const LinkRequired = Schema.Struct({ status: Schema.Literal("vercel_link_required"), link: Link })
const Failed = Schema.Struct({ status: Schema.Literal("failed"), reason: Text })
/** What the pane reports back. Each status carries exactly its own data. */
export const Outcome = Schema.Union([Ready, LinkRequired, Failed])
export type Outcome = typeof Outcome.Type

/** Tool output: failures are tool errors; a link requirement echoes the identical retry input. */
export const WorktreeOutput = Schema.Union([Ready, Schema.Struct({ ...LinkRequired.fields, retry: WorktreeInput })])
export type WorktreeOutput = typeof WorktreeOutput.Type

export const PaneRequest = Schema.Struct({
  id: Text,
  sessionID: Text,
  rootID: Text,
  cwd: Text,
  kind: Schema.Literal("worktree"),
  input: WorktreeInput,
})
export type PaneRequest = typeof PaneRequest.Type

const identity = { clientID: Text, rootID: Text }
const Identity = Schema.Struct(identity)
const Pulse = Schema.Struct({ request: Schema.NullOr(PaneRequest), active: Schema.Array(Text).check(Schema.isMaxLength(64)) })
const Authorized = Schema.Struct({ authorized: Schema.Boolean })
const Completion = Schema.Struct({ ...identity, id: Text, outcome: Outcome })
const Acknowledged = Schema.Struct({ acknowledged: Schema.Boolean })
const Released = Schema.Struct({ released: Schema.Boolean })

const exact = { exact: true } as const
export const bridgeDefinition = {
  id: "dotfiles-tools",
  methods: {
    pulse: { input: portable(Identity, exact), output: portable(Pulse, exact) },
    authorize: { input: portable(Schema.Struct({ ...identity, id: Text }), exact), output: portable(Authorized, exact) },
    complete: { input: portable(Completion, exact), output: portable(Acknowledged, exact) },
    release: { input: portable(Identity, exact), output: portable(Released, exact) },
  },
  events: {},
} as const

// Exact decoders (unknown keys are errors) for the TUI and pane code: the Promise RPC client
// does not decode portable output itself. They throw on invalid input.
const decoder = <S extends Schema.Codec<unknown, unknown>>(schema: S) => Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })
export const decodeWorktreeInput = decoder(WorktreeInput)
export const decodeDestination = decoder(Destination)
export const decodeLink = decoder(Link)
export const decodeOutcome = decoder(Outcome)
export const decodePulse = decoder(Pulse)
export const decodeAuthorized = decoder(Authorized)
export const decodeAcknowledged = decoder(Acknowledged)
