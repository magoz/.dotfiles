#!/usr/bin/env bun
import { Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Cause, Console, Effect, Layer, Option } from "effect"
import { checkoutEnvironment } from "./checkout"
import { WorktreeError, checkoutFailureReport } from "./domain"
import { createEnvironment } from "./lifecycle"
import { Process, ProcessLive } from "./process"

const optionalText = (name: string, description: string) =>
  Options.text(name).pipe(Options.withDescription(description), Options.optional)

/** --json: keep stdout for the single result; progress and child stdout go to stderr. */
const toStderr = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const service = yield* Process
    return yield* Console.consoleWith((console) => effect.pipe(
      Console.withConsole({ ...console, log: console.error }),
      Effect.provideService(Process, {
        ...service,
        inherit: (command, args, options) => service.inherit(command, args, {
          ...options,
          stdoutToStderr: true
        })
      })
    ))
  })

const repoOption = Options.text("repo").pipe(
  Options.withDescription("source Git checkout (default: current directory)"),
  Options.withDefault(".")
)
const baseOption = optionalText(
  "base",
  "explicit base override, used without fetching (default: freshly fetched origin HEAD)"
)
const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("emit a JSON success result; send progress and child output to stderr")
)
const ttlOption = Options.text("ttl").pipe(
  Options.withDescription("sandbox database lifetime (default: 7d)"),
  Options.withDefault("7d")
)
const setupOption = Options.text("setup").pipe(
  Options.withDescription("repository setup command run after provisioning; repeatable"),
  Options.repeated
)

const create = Command.make(
  "create",
  {
    repo: repoOption,
    branch: Options.text("branch").pipe(
      Options.withDescription("new or existing local branch to check out")
    ),
    base: baseOption,
    path: optionalText("path", "explicit worktree checkout path"),
    label: optionalText("label", "Herdr workspace/database label (also the Pi session name)"),
    agent: Options.choice("agent", ["pi", "opencode"] as const).pipe(
      Options.withDescription("destination agent harness (default: pi)"),
      Options.withDefault("pi")
    ),
    json: jsonOption,
    ttl: ttlOption,
    prompt: optionalText("prompt", "kickoff prompt sent to the new agent session"),
    setup: setupOption
  },
  ({ agent, base, branch, json, label, path, prompt, repo, setup, ttl }) =>
    Effect.gen(function* () {
      const creation = createEnvironment({
        agent,
        repo,
        branch,
        ttl,
        setupCommands: setup,
        ...(Option.isSome(base) ? { base: base.value } : {}),
        ...(Option.isSome(path) ? { path: path.value } : {}),
        ...(Option.isSome(label) ? { label: label.value } : {}),
        ...(Option.isSome(prompt) ? { prompt: prompt.value } : {})
      })
      const created = yield* (json ? toStderr(creation) : creation)

      if (json) {
        yield* Console.log(JSON.stringify(created))
        return
      }
      yield* Console.log("")
      yield* Console.log("worktree: ready")
      yield* Console.log(`  branch:     ${created.branch}`)
      yield* Console.log(`  base:       ${created.base}`)
      yield* Console.log(`  path:       ${created.path}`)
      yield* Console.log(`  workspace:  ${created.workspaceId}`)
      yield* Console.log(created.agentKind === "pi"
        ? `  pi agent:   ${created.agentName}`
        : `  opencode agent: ${created.agentName}`)
      if (created.warnings.length > 0) {
        yield* Console.log(`  warnings:   ${created.warnings.length}`)
      }
    })
)

const checkout = Command.make(
  "checkout",
  {
    repo: repoOption,
    branch: Options.text("branch").pipe(
      Options.withDescription("new local branch to create (an existing branch is refused)")
    ),
    base: baseOption,
    path: optionalText("path", "explicit checkout path (default: <primary-repo>-<branch-slug> sibling)"),
    label: optionalText("label", "sandbox database label (default: branch)"),
    json: Options.boolean("json").pipe(
      Options.withDescription("emit one JSON result on stdout (success object, or a failure report with a nonzero exit)")
    ),
    ttl: ttlOption,
    setup: setupOption
  },
  ({ base, branch, json, label, path, repo, setup, ttl }) =>
    Effect.gen(function* () {
      const checkingOut = checkoutEnvironment({
        repo,
        branch,
        ttl,
        setupCommands: setup,
        ...(Option.isSome(base) ? { base: base.value } : {}),
        ...(Option.isSome(path) ? { path: path.value } : {}),
        ...(Option.isSome(label) ? { label: label.value } : {})
      })
      const created = yield* (json ? toStderr(checkingOut) : checkingOut).pipe(
        Effect.catchTag("CheckoutError", (error) =>
          // Outside the stderr redirection: report what exists as data on stdout;
          // the human diagnostic stays on stderr.
          (json ? Console.log(JSON.stringify(checkoutFailureReport(error))) : Effect.void).pipe(
            Effect.zipRight(Effect.fail(new WorktreeError({ message: error.message })))
          ))
      )

      if (json) {
        yield* Console.log(JSON.stringify(created))
        return
      }
      yield* Console.log("")
      yield* Console.log("worktree: checkout ready")
      yield* Console.log(`  branch:     ${created.branch}`)
      yield* Console.log(`  base:       ${created.base}`)
      yield* Console.log(`  path:       ${created.path}`)
      if (created.warnings.length > 0) {
        yield* Console.log(`  warnings:   ${created.warnings.length}`)
      }
    })
).pipe(
  Command.withDescription(
    "Create and provision a sibling Git worktree without Herdr or an agent (OpenCode/Fleet strategy)."
  )
)

const root = Command.make("worktree", {}, () =>
  Console.log("worktree: run with --help to see available commands")
).pipe(
  Command.withDescription(
    "Create a provisioned Herdr Git worktree and launch Pi (default) or OpenCode.\n\n" +
      "Documentation: ~/.local/share/worktree/README.md"
  ),
  Command.withSubcommands([create, checkout])
)

const cli = Command.run(root, { name: "worktree", version: "0.1.0" })
const MainLayer = Layer.mergeAll(NodeContext.layer, ProcessLive)

Effect.suspend(() => cli(process.argv)).pipe(
  Effect.catchTags({
    WorktreeError: (error) => failWith(error.message),
    ProcessError: (error) => failWith(error.message)
  }),
  // Runtime's default error logger writes to stdout, which would corrupt --json
  // on CLI validation errors or unexpected defects. Report all failures here.
  Effect.catchAllCause((cause) => failWith(Cause.pretty(cause))),
  Effect.provide(MainLayer),
  NodeRuntime.runMain
)

function failWith(message: string) {
  return Console.error(`worktree: ${message}`).pipe(
    Effect.zipRight(
      Effect.sync(() => {
        process.exitCode = 2
      })
    )
  )
}
