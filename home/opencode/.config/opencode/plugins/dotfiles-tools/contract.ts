// `create_worktree` contract: Effect Schemas for the tool and the `provision-env` preflight report.
// The host validates with the `portable` forms (see ../shared/portable.ts).
import { Schema } from "effect"

export const MAX_TEXT = 16_384
/** Non-empty, bounded, no NUL: values end up as CLI argv and prompt text. */
export const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_TEXT), Schema.makeFilter((value) => !value.includes("\0")))

/** Model-facing tool input. Repo/cwd are deliberately absent: the server resolves them. */
export const WorktreeInput = Schema.Struct({
  branch: Schema.optionalKey(Text),
  base: Schema.optionalKey(Text),
  prompt: Schema.optionalKey(Text),
})
export type WorktreeInput = typeof WorktreeInput.Type
/** Input after branch inference: `branch` is always present. */
export type ResolvedInput = WorktreeInput & { readonly branch: string }

/** `provision-env --check-vercel-link` exit-3 report. */
export const Link = Schema.Struct({ status: Schema.Literal("vercel_link_required"), directory: Text, reason: Text })
export type Link = typeof Link.Type

/** The new worktree and the destination session that owns the task. */
export const Destination = Schema.Struct({
  directory: Text,
  branch: Text,
  sessionID: Text,
  /** Whether the kickoff prompt was sent; false when the input had none. */
  prompted: Schema.Boolean,
})
export type Destination = typeof Destination.Type

const Ready = Schema.Struct({ status: Schema.Literal("ready"), destination: Destination })
/** Nothing was allocated; retry with the identical input once the link exists. */
const LinkRequired = Schema.Struct({ status: Schema.Literal("vercel_link_required"), link: Link, retry: WorktreeInput })
/** Tool output. Failures are tool errors. Each status carries exactly its own data. */
export const WorktreeOutput = Schema.Union([Ready, LinkRequired])
export type WorktreeOutput = typeof WorktreeOutput.Type

const decoder = <S extends Schema.Codec<unknown, unknown>>(schema: S) => Schema.decodeUnknownOption(schema, { onExcessProperty: "error" })
export const decodeWorktreeInput = Schema.decodeUnknownSync(WorktreeInput, { onExcessProperty: "error" })
export const decodeLink = decoder(Schema.fromJsonString(Link))
export const decodeOutput = Schema.decodeUnknownSync(WorktreeOutput, { onExcessProperty: "error" })
