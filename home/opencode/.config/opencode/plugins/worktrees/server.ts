// OpenCode worktree strategy `dotfiles` (V2 Effect API): provisioned sibling checkouts through
// `worktree checkout`, Herdr-free retirement through `worktree-manage`. Interruption cancels the
// CLI and reaps its process group. Errors are sanitized: reported values only, never CLI text.
import { lstatSync, readFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin/effect/plugin"
import type { WorktreeDefinition } from "@opencode/plugin/effect/worktree"
import type { WorktreeCreateInput, WorktreeEntry, WorktreeRemoveInput } from "@opencode/plugin/worktree"
import { Data, type Duration, Effect, Option, Schema, type Scope } from "effect"
import { runProcess, withoutPaneEnv, type Capture } from "../shared/process.ts"
import { branchFromName } from "./naming.ts"

export const STRATEGY_ID = "dotfiles"

// Bounds. Provisioning (install + Vercel pull + two Neon branches) can take minutes.
const CREATE_TIMEOUT: Duration.Input = "30 minutes"
const PLAN_TIMEOUT: Duration.Input = "5 minutes"
const RETIRE_TIMEOUT: Duration.Input = "15 minutes"
const GIT_TIMEOUT: Duration.Input = "30 seconds"
// Every run waits this grace before a final group SIGKILL. The CLIs' own runner waits 2s before
// SIGKILLing descendants, so outlast it; plain git needs none.
const CLI_GRACE_MS = 3000
const GIT_GRACE_MS = 250
const MAX_OUTPUT = 65_536

/** A user-facing failure with a sanitized message. */
export class WorktreeError extends Data.TaggedError("WorktreeError")<{ readonly message: string }> {}
const fail = (message: string) => Effect.fail(new WorktreeError({ message }))

// Reported values are echoed in errors: absolute, single-line, bounded, no URLs. Composed from
// built-in filters only (`Schema.makeFilter` is types-only in this Effect RC, undefined at runtime).
const AbsolutePath = Schema.String.check(
  Schema.isMaxLength(4095),
  Schema.isPattern(/^\//),
  Schema.isPattern(/^[^\x00-\x1f\x7f]*$/),
  Schema.isPattern(/^(?!.*:\/\/).*$/),
)
const Branch = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._/-]{1,255}$/))
const isPath = Schema.is(AbsolutePath)
const isBranch = Schema.is(Branch)

/** Exact `worktree checkout --json` success object (no extra keys). */
const Checkout = Schema.Struct({
  source: AbsolutePath,
  path: AbsolutePath,
  branch: Branch,
  base: Schema.String,
  warnings: Schema.Array(Schema.String.check(Schema.isMaxLength(1023))),
})
/** `worktree checkout --json` failure report: stage + what exists, never free text. */
const CheckoutFailure = Schema.Struct({
  status: Schema.Literal("failed"),
  branch: Schema.String,
  stage: Schema.optionalKey(Schema.String),
  checkout: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
})
const Plan = Schema.Struct({ path: Schema.String, token: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) })
const Receipt = Schema.Struct({ status: Schema.Literal("retired"), path: Schema.String })
const Marker = Schema.Struct({ strategy: Schema.Literal("dotfiles"), branch: Branch, createdAt: Schema.String })

const json = <S extends Schema.Codec<unknown, unknown>>(schema: S, options?: { readonly exact?: boolean }) => {
  const decode = Schema.decodeUnknownOption(Schema.fromJsonString(schema), options?.exact ? { onExcessProperty: "error" } : undefined)
  return (text: string) => decode(text.trim())
}
const parseCheckout = json(Checkout, { exact: true })
const parseFailure = json(CheckoutFailure)
const parsePlan = json(Plan)
const parseReceipt = json(Receipt)
const parseMarker = json(Marker)

function checkoutFailure(stdout: string, branch: string): string {
  const report = Option.getOrUndefined(parseFailure(stdout))
  if (!report || report.branch !== branch) {
    return `worktree checkout failed without a report for ${branch}; inspect for a partial checkout before retrying`
  }
  if (report.stage === "preflight" && report.checkout === "none") {
    return `worktree checkout refused ${branch} before allocating anything (existing branch, invalid name, unreachable origin, missing base, or occupied destination); run \`worktree checkout\` manually for details`
  }
  if (!isPath(report.path)) return `worktree checkout failed for ${branch}; inspect for a partial checkout before retrying`
  if (report.stage === "create" && report.checkout === "unknown") {
    return `git worktree add failed for ${branch}; inspect ${report.path} and the branch before retrying`
  }
  if ((report.stage === "provision" || report.stage === "setup") && report.checkout === "preserved") {
    return `${report.stage} failed; preserved checkout ${report.path} on branch ${branch}. Inspect it; retire it with worktree-manage plan-checkout/retire-checkout`
  }
  return `worktree checkout failed for ${branch}; inspect for a partial checkout before retrying`
}

/** worktree-manage prints only sanitized ManagerError text ("worktree-manage: ..."); nothing else is echoed. */
function managerReason(stderr: string): string {
  const line = stderr.trim().split("\n").at(-1) ?? ""
  const match = /^worktree-manage: ([ -~]{1,300})$/.exec(line)
  return match?.[1] && !match[1].includes("://") ? match[1] : "unknown refusal"
}

// Ownership marker written by `worktree checkout` into the linked worktree's PRIVATE git dir
// (`<common>/worktrees/<id>/dotfiles-worktree`); format and rules:
// home/scripts/.local/share/worktree/src/marker.ts. Found through the checkout's `.git` file
// (`gitdir: <path>`) so listing needs no subprocess per worktree.
export const MARKER_FILE = "dotfiles-worktree"

/** The branch recorded in a checkout's ownership marker, or undefined if not owned. */
export function markedBranch(directory: string): string | undefined {
  try {
    const link = path.join(directory, ".git")
    if (!lstatSync(link).isFile()) return undefined
    const match = /^gitdir: (.+)$/.exec(readFileSync(link, "utf8").trim())
    if (!match?.[1]) return undefined
    const gitDir = path.resolve(directory, match[1])
    if (path.basename(path.dirname(gitDir)) !== "worktrees") return undefined
    return Option.getOrUndefined(parseMarker(readFileSync(path.join(gitDir, MARKER_FILE), "utf8")))?.branch
  } catch {
    return undefined
  }
}

export interface ListedWorktree {
  readonly directory: string
  readonly type: "root" | "worktree"
  readonly branch: string | null
}

/** Parses `git worktree list --porcelain -z`. The first record is the primary checkout (root); bare and prunable records are skipped. */
export function parseWorktreeList(stdout: string): readonly ListedWorktree[] {
  const entries: ListedWorktree[] = []
  let fields: string[] = []
  let index = 0
  for (const field of stdout.split("\0")) {
    if (field !== "") {
      fields.push(field)
      continue
    }
    if (fields.length === 0) continue
    const first = fields[0] ?? ""
    const directory = first.startsWith("worktree ") ? first.slice("worktree ".length) : undefined
    if (!isPath(directory)) throw new Error("Unexpected git worktree list output")
    const skip = fields.some((item) => item === "bare" || item === "prunable" || item.startsWith("prunable "))
    const branch = fields.find((item) => item.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length) ?? null
    if (!skip) entries.push({ directory, type: index === 0 ? "root" : "worktree", branch })
    index += 1
    fields = []
  }
  if (fields.length > 0) throw new Error("Unexpected git worktree list output")
  return entries
}

export function createStrategy(env: NodeJS.ProcessEnv = process.env): WorktreeDefinition {
  // The plugin process's own environment (opencode.service), never Herdr pane identity.
  const childEnv = withoutPaneEnv(env)
  const exec = (command: string, args: readonly string[], options: { readonly cwd: string; readonly timeout: Duration.Input; readonly capture?: Capture }) =>
    runProcess(command, args, {
      cwd: options.cwd,
      env: childEnv,
      timeout: options.timeout,
      capture: options.capture ?? "stdout",
      maxBytes: MAX_OUTPUT,
      cleanupGraceMs: command === "git" ? GIT_GRACE_MS : CLI_GRACE_MS,
    })

  const create = (input: WorktreeCreateInput) =>
    Effect.gen(function* () {
      if (!isPath(input.sourceDirectory) || !isPath(input.directory)) return yield* fail("Invalid worktree create input")
      if (input.branch !== undefined && input.branch.trim() === "") return yield* fail("Invalid starting ref")
      // OpenCode's `name` is the suggested directory's last segment; its parent is ignored:
      // the CLI always places the checkout beside the primary repository.
      const branch = yield* Effect.try({
        try: () => branchFromName(path.basename(input.directory)),
        catch: (error) => new WorktreeError({ message: error instanceof Error ? error.message : "Invalid worktree name" }),
      })
      const args = ["checkout", "--json", "--repo", input.sourceDirectory, "--branch", branch]
      // OpenCode's `branch` is a starting ref, i.e. the CLI's explicit --base (no fetch).
      if (input.branch !== undefined) args.push("--base", input.branch.trim())
      const result = yield* exec("worktree", args, { cwd: input.sourceDirectory, timeout: CREATE_TIMEOUT })
      if (result.code !== 0) return yield* fail(checkoutFailure(result.stdout, branch))
      const created = Option.getOrUndefined(parseCheckout(result.stdout))
      if (!created || created.branch !== branch) {
        return yield* fail(`worktree checkout returned an invalid result for ${branch}; inspect for a checkout before retrying`)
      }
      for (const warning of created.warnings) yield* Effect.logWarning(`[worktrees] ${created.path}: ${warning}`)
      return { directory: created.path }
    })

  const remove = (input: WorktreeRemoveInput) =>
    Effect.gen(function* () {
      if (!isPath(input.directory)) return yield* fail("Invalid worktree remove input")
      if (input.force !== false) {
        return yield* fail("The dotfiles worktree strategy never force-removes. Commit, stash or clean the checkout, then delete it again.")
      }
      const directory = input.directory
      if (markedBranch(directory) === undefined) {
        return yield* fail(`${directory} is not a dotfiles worktree (no ownership marker); refusing to remove it. Retire Herdr/Pi worktrees with worktree-manage or /worktrees.`)
      }
      const common = yield* exec("git", ["-C", directory, "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: directory, timeout: GIT_TIMEOUT })
      if (common.code !== 0) return yield* fail(`Not a Git checkout: ${directory}`)
      const commonDir = common.stdout.trim()
      if (!isPath(commonDir) || path.basename(commonDir) !== ".git") return yield* fail("Only checkouts of a non-bare primary repository are supported")
      const primary = path.dirname(commonDir)

      // Herdr-free retirement: plan, then retire with the exact plan token. No agent checks:
      // OpenCode/Fleet must not delete a worktree that still has working sessions.
      const plan = yield* exec("worktree-manage", ["plan-checkout", "--cwd", primary, "--path", directory], { cwd: primary, timeout: PLAN_TIMEOUT, capture: "both" })
      if (plan.code !== 0) return yield* fail(`Retirement refused for ${directory}: ${managerReason(plan.stderr)}. Checkout preserved.`)
      const planned = Option.getOrUndefined(parsePlan(plan.stdout))
      if (!planned || planned.path !== directory) return yield* fail(`Invalid retirement plan for ${directory}; checkout preserved`)
      const retired = yield* exec(
        "worktree-manage",
        ["retire-checkout", "--cwd", primary, "--path", directory, "--confirm", directory, "--expect-plan", planned.token],
        { cwd: primary, timeout: RETIRE_TIMEOUT, capture: "both" },
      )
      if (retired.code !== 0) {
        return yield* fail(`Retirement stopped for ${directory}: ${managerReason(retired.stderr)}. Inspect ~/.local/state/worktree-manager receipts before retrying.`)
      }
      const receipt = Option.getOrUndefined(parseReceipt(retired.stdout))
      if (!receipt || receipt.path !== directory) {
        return yield* fail(`Unexpected retirement result for ${directory}; inspect ~/.local/state/worktree-manager receipts`)
      }
    })

  const list = (sourceDirectory: string) =>
    Effect.gen(function* () {
      if (!isPath(sourceDirectory)) return yield* fail("Invalid source directory")
      const listed = yield* exec("git", ["-C", sourceDirectory, "worktree", "list", "--porcelain", "-z"], { cwd: sourceDirectory, timeout: GIT_TIMEOUT })
      if (listed.code !== 0) return yield* fail(`git worktree list failed for ${sourceDirectory}`)
      const entries = yield* Effect.try({ try: () => parseWorktreeList(listed.stdout), catch: () => new WorktreeError({ message: "Unexpected git worktree list output" }) })
      // Only marked checkouts on their recorded branch are `worktree` (owned by this strategy).
      // Everything else (primary, Herdr/Pi, plain `git worktree add`) is reported as `root`: core
      // stores it UNOWNED, so worktree.remove refuses it, and since this strategy is consulted
      // first the built-in `git` strategy never claims it.
      return entries.map(({ directory, type, branch }): WorktreeEntry => ({
        directory,
        type: type === "worktree" && branch !== null && markedBranch(directory) === branch ? "worktree" : "root",
      }))
    })

  return { id: STRATEGY_ID, create, remove, list }
}

/** The slice of OpenCode's plugin `Context` used here; the real `Context` satisfies it. */
export interface Host {
  readonly worktree: {
    readonly transform: (callback: (editor: { add(definition: WorktreeDefinition): void }) => void) => Effect.Effect<unknown, never, Scope.Scope>
  }
}

export const setup = (host: Host, env: NodeJS.ProcessEnv = process.env) =>
  host.worktree.transform((editor) => editor.add(createStrategy(env))).pipe(Effect.asVoid)

export default {
  id: "worktrees",
  effect: (ctx) => setup(ctx),
} satisfies Plugin
