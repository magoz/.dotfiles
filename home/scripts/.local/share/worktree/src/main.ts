#!/usr/bin/env bun
import { Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Cause, Console, Effect, Layer, Option } from "effect"
import { createEnvironment } from "./lifecycle"
import { Process, ProcessLive } from "./process"

const optionalText = (name: string, description: string) =>
  Options.text(name).pipe(Options.withDescription(description), Options.optional)

const create = Command.make(
  "create",
  {
    repo: Options.text("repo").pipe(
      Options.withDescription("source Git checkout (default: current directory)"),
      Options.withDefault(".")
    ),
    branch: Options.text("branch").pipe(
      Options.withDescription("new or existing local branch to check out")
    ),
    base: optionalText(
      "base",
      "explicit base override, used without fetching (default: freshly fetched origin HEAD)"
    ),
    path: optionalText("path", "explicit worktree checkout path"),
    label: optionalText("label", "Herdr workspace/database label (also the Pi session name)"),
    agent: Options.choice("agent", ["pi", "opencode"] as const).pipe(
      Options.withDescription("destination agent harness (default: pi)"),
      Options.withDefault("pi")
    ),
    json: Options.boolean("json").pipe(
      Options.withDescription("emit a JSON success result; send progress and child output to stderr")
    ),
    ttl: Options.text("ttl").pipe(
      Options.withDescription("sandbox database lifetime (default: 7d)"),
      Options.withDefault("7d")
    ),
    prompt: optionalText("prompt", "kickoff prompt sent to the new agent session"),
    setup: Options.text("setup").pipe(
      Options.withDescription("repository setup command run after provisioning; repeatable"),
      Options.repeated
    )
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
      const service = yield* Process
      const created = yield* (json
        ? Console.consoleWith((console) => creation.pipe(
            Console.withConsole({ ...console, log: console.error }),
            Effect.provideService(Process, {
              ...service,
              inherit: (command, args, options) => service.inherit(command, args, {
                ...options,
                stdoutToStderr: true
              })
            })
          ))
        : creation)

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

const root = Command.make("worktree", {}, () =>
  Console.log("worktree: run with --help to see available commands")
).pipe(
  Command.withDescription(
    "Create a provisioned Herdr Git worktree and launch Pi (default) or OpenCode.\n\n" +
      "Documentation: ~/.local/share/worktree/README.md"
  ),
  Command.withSubcommands([create])
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
