// `create_worktree` and `/worktree` (OpenCode V2 Effect API). Same path as Fleet's launcher: a
// provisioned checkout through OpenCode's native worktree API (the dotfiles `worktrees` strategy),
// then a fresh session there that receives the task. No Herdr, no TUI: works from the web app,
// Fleet and the TUI, for this session's repository or any other.
import path from "node:path"
import type { SessionCreateInput, SessionMoveInput, SessionPromptInput, WorktreeCreateInput, WorktreeRemoveInput } from "@opencode/client/effect/api"
import type { CommandDefinition, CommandInvocation } from "@opencode/plugin/effect/command"
import type { Plugin } from "@opencode/plugin/effect/plugin"
import type { Project } from "@opencode/schema/project"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import { Data, Effect, Option, type Scope } from "effect"
import { runProcess, withoutPaneEnv } from "../shared/process.ts"
import { portable } from "../shared/portable.ts"
import { branchToName } from "../worktrees/naming.ts"
import { WorktreeInput, WorktreeOutput, decodeLink, type Link, type WorktreeOutput as Output } from "./contract.ts"
import { BASE_GUIDANCE, LINK_GUIDANCE, resolveInput } from "./worktree.ts"

const PREFLIGHT_TIMEOUT = "30 seconds"
const GIT_TIMEOUT = "10 seconds"
const DESCRIPTION = `Only when the user explicitly asks: create a provisioned worktree (branch from origin's default branch) and a fresh OpenCode session there that receives \`prompt\` as its task. \`repo\`: absolute path of the repository to branch when it is not this session's (default). Requires the root session. Source session stays open. Put any extra setup the destination needs in \`prompt\`. ${BASE_GUIDANCE} ${LINK_GUIDANCE}`
const READY_NOTE = "The destination session owns the task. Do not continue implementation in this session. Do not retry a successful allocation."

class HandoffError extends Data.TaggedError("HandoffError")<{ readonly message: string }> {}

const ToolInputSchema = portable(WorktreeInput, { exact: true })
const ToolOutputSchema = portable(WorktreeOutput, { exact: true })
export type CreateWorktreeTool = Tool.Info<typeof ToolInputSchema, typeof ToolOutputSchema>

interface SessionLike {
  readonly id: string
  readonly projectID: Project.ID
  readonly parentID?: string | undefined
  readonly subpath?: string | undefined
  readonly location: { readonly directory: string; readonly workspaceID?: string | undefined }
}

/** The slice of OpenCode's plugin `Context` used here; the real `Context` satisfies it (see default export). */
export interface Host {
  readonly location: { readonly directory: string; readonly workspaceID?: string | undefined }
  readonly session: {
    readonly get: (input: { readonly sessionID: Session.ID }) => Effect.Effect<SessionLike, unknown>
    readonly create: (input: SessionCreateInput) => Effect.Effect<{ readonly id: Session.ID; readonly projectID: Project.ID }, unknown>
    readonly remove: (input: { readonly sessionID: Session.ID }) => Effect.Effect<unknown, unknown>
    readonly move: (input: SessionMoveInput) => Effect.Effect<unknown, unknown>
    readonly prompt: (input: SessionPromptInput) => Effect.Effect<unknown, unknown>
  }
  readonly worktree: {
    readonly create: (input: WorktreeCreateInput) => Effect.Effect<{ readonly directory: AbsolutePath }, unknown>
    readonly remove: (input: WorktreeRemoveInput) => Effect.Effect<unknown, unknown>
  }
  readonly command: {
    readonly transform: (callback: (editor: { add(definition: CommandDefinition): void }) => void) => Effect.Effect<unknown, never, Scope.Scope>
  }
  readonly tool: {
    readonly transform: (callback: (editor: { add(tool: CreateWorktreeTool): void }) => void) => Effect.Effect<unknown, never, Scope.Scope>
  }
}

export interface Options {
  /** Runs `git` and the `provision-env` preflight (tests inject a fake). */
  readonly run?: typeof runProcess
  /** The service's environment; `HERDR_*` is always stripped. */
  readonly env?: NodeJS.ProcessEnv
}

/** First line of a host failure, bounded. Worktree strategy errors are already sanitized. */
const reason = (error: unknown): string => {
  const message = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : ""
  return message.split("\n")[0]?.trim().slice(0, 500) || "no details"
}

/** The user's request for `/worktree`: the agent picks the branch and calls `create_worktree`. */
export const worktreeRequest = (task: string) =>
  [
    "The user explicitly requests a new worktree. Use create_worktree for the task below; infer a concise conventional branch or use an explicitly named branch, and pass the task as its prompt. Pass repo when the task names another repository. Ask before consequential ambiguity. This session stays open.",
    BASE_GUIDANCE,
    LINK_GUIDANCE,
    task ? `Task: ${task}` : "No task was given: ask the user what the new worktree is for.",
  ].join("\n")

export const setup = (host: Host, options: Options = {}) =>
  Effect.gen(function* () {
    const run = options.run ?? runProcess
    const env = withoutPaneEnv(options.env ?? process.env)

    /** The root session's working directory, after checking location and subpath. */
    const sourceDirectory = (sessionID: string) =>
      Effect.gen(function* () {
        const session = yield* host.session.get({ sessionID: Session.ID.make(sessionID) }).pipe(Effect.mapError(() => new HandoffError({ message: "Invalid session location" })))
        if (session.id !== sessionID || !path.isAbsolute(session.location.directory)) return yield* new HandoffError({ message: "Invalid session location" })
        if (session.parentID) return yield* new HandoffError({ message: "This operation requires the root session" })
        if (session.location.directory !== host.location.directory || (session.location.workspaceID ?? undefined) !== (host.location.workspaceID ?? undefined)) {
          return yield* new HandoffError({ message: "Session does not belong to this plugin location" })
        }
        if (session.subpath !== undefined && path.isAbsolute(session.subpath)) return yield* new HandoffError({ message: "Invalid session subpath" })
        const cwd = path.resolve(session.location.directory, session.subpath ?? ".")
        const relative = path.relative(session.location.directory, cwd)
        if (relative === ".." || relative.startsWith(`..${path.sep}`)) return yield* new HandoffError({ message: "Session subpath escapes location" })
        return cwd
      })

    /** The top level of the Git checkout containing `directory`. */
    const checkout = (directory: string) =>
      Effect.gen(function* () {
        const invalid = new HandoffError({ message: `Not a Git checkout: ${directory}` })
        if (!path.isAbsolute(directory)) return yield* new HandoffError({ message: "repo must be an absolute path" })
        const result = yield* run("git", ["-C", directory, "rev-parse", "--show-toplevel"], { cwd: "/", env, timeout: GIT_TIMEOUT, capture: "stdout" }).pipe(Effect.mapError(() => invalid))
        const top = result.stdout.trim()
        if (result.code !== 0 || !path.isAbsolute(top) || top.includes("\n")) return yield* invalid
        return AbsolutePath.make(top)
      })

    /** Vercel link check before anything is allocated. Only a strict exit-3 report is recoverable. */
    const preflight = (cwd: string) =>
      Effect.gen(function* () {
        const result = yield* run("provision-env", ["--repo", cwd, "--check-vercel-link", "--non-interactive"], {
          cwd,
          env,
          timeout: PREFLIGHT_TIMEOUT,
          capture: "both",
        }).pipe(Effect.mapError(() => new HandoffError({ message: "Vercel preflight failed; nothing allocated" })))
        if (result.code === 0) return Option.none<Link>()
        const link = result.code === 3 ? decodeLink(result.stderr.trim()).pipe(Option.filter((value) => path.isAbsolute(value.directory))) : Option.none<Link>()
        if (Option.isNone(link)) return yield* new HandoffError({ message: "Vercel preflight failed; nothing allocated" })
        return link
      })

    const execute = (input: WorktreeInput, tool: { readonly sessionID: string }) =>
      Effect.gen(function* () {
        const resolved = yield* Effect.try({ try: () => resolveInput(input), catch: (error) => new HandoffError({ message: error instanceof Error ? error.message : "Invalid input" }) })
        const name = yield* Effect.try({
          try: () => branchToName(resolved.branch),
          catch: () => new HandoffError({ message: `Branch ${resolved.branch} has no exact worktree name: use "/"-separated segments of letters, digits, ".", "_" and "-", none starting or ending with "-" or containing "--"` }),
        })
        const cwd = yield* sourceDirectory(tool.sessionID)
        const repo = yield* checkout(resolved.repo ?? cwd)
        const link = yield* preflight(repo)
        if (Option.isSome(link)) {
          const output: Output = { status: "vercel_link_required", link: link.value, retry: resolved }
          return { output, content: `${JSON.stringify(output)}\n${LINK_GUIDANCE}` }
        }
        // Plugins cannot look up a directory's project, but creating a session there resolves it:
        // the destination session starts in `repo` and moves into the worktree once it exists.
        // Untitled, so OpenCode names it from the task (it only titles untitled sessions).
        const session = yield* host.session
          .create({ location: { directory: repo } })
          .pipe(Effect.mapError((error) => new HandoffError({ message: `Creating the destination session failed: ${reason(error)}; nothing allocated` })))
        // Everything after this point is rolled back on failure or interruption, so an identical
        // retry works: the session is deleted and a created worktree retired (never forced). A
        // checkout the strategy kept after its own failure is reported in its message.
        let directory: AbsolutePath | undefined
        const rollback = Effect.gen(function* () {
          const left: string[] = []
          if (directory !== undefined) {
            const retired = yield* host.worktree.remove({ projectID: session.projectID, directory, force: false }).pipe(Effect.isSuccess)
            if (!retired) left.push(`worktree ${directory} (retire it with worktree-manage plan-checkout/retire-checkout)`)
          }
          const removed = yield* host.session.remove({ sessionID: session.id }).pipe(Effect.isSuccess)
          if (!removed) left.push(`session ${session.id}`)
          return left.length === 0 ? "Rolled back: nothing left behind" : `Rollback incomplete; still exists: ${left.join(", ")}`
        })
        const step = <A>(effect: Effect.Effect<A, unknown>, failure: string) => effect.pipe(Effect.mapError((error) => new HandoffError({ message: `${failure}: ${reason(error)}` })))
        yield* Effect.gen(function* () {
          // `branch` is OpenCode's starting ref: the strategy passes it as the CLI's --base (no fetch).
          directory = (yield* step(host.worktree.create({ projectID: session.projectID, name, ...(resolved.base ? { branch: resolved.base } : {}) }), "Creating the worktree failed")).directory
          // Queued before the task, so the task runs in the worktree.
          yield* step(host.session.move({ sessionID: session.id, directory }), "Moving the destination session failed")
          if (resolved.prompt) yield* step(host.session.prompt({ sessionID: session.id, text: resolved.prompt }), "Sending the task failed")
        }).pipe(
          Effect.catch((error) => rollback.pipe(Effect.flatMap((result) => Effect.fail(new HandoffError({ message: `${error.message}. ${result}` }))))),
          Effect.onInterrupt(() => rollback.pipe(Effect.ignore)),
        )
        if (directory === undefined) return yield* new HandoffError({ message: "Worktree was not created" })
        const output: Output = { status: "ready", destination: { directory, branch: resolved.branch, sessionID: session.id, prompted: resolved.prompt !== undefined } }
        return { output, content: `${JSON.stringify(output)}\n${READY_NOTE}` }
      }).pipe(Effect.mapError((error) => new Tool.Error({ message: error.message })))

    yield* host.tool.transform((editor) => {
      editor.add({
        name: "create_worktree",
        description: DESCRIPTION,
        input: ToolInputSchema,
        output: ToolOutputSchema,
        options: { codemode: false, permission: "create_worktree" },
        execute,
      })
    })

    // A server command, so it works in every client. It submits a user request, never a tool call.
    const command = (input: CommandInvocation) =>
      host.session.prompt({ sessionID: input.sessionID, text: worktreeRequest(input.prompt.text.trim()), delivery: input.delivery }).pipe(Effect.asVoid)
    yield* host.command.transform((editor) => {
      editor.add({ name: "worktree", description: "New worktree and session for a task", execute: command })
    })
    return { execute, command }
  })

export default {
  id: "dotfiles-tools",
  effect: (ctx) => setup(ctx).pipe(Effect.asVoid),
} satisfies Plugin
