#!/usr/bin/env bun
import { Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer, Option } from "effect"
import { createEnvironment } from "./lifecycle"
import { ProcessLive } from "./process"

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
      "base ref for a new branch (default: origin default, main/master, then HEAD)"
    ),
    path: optionalText("path", "explicit worktree checkout path"),
    label: optionalText("label", "Herdr workspace, database, and Pi session label"),
    ttl: Options.text("ttl").pipe(
      Options.withDescription("sandbox database lifetime (default: 7d)"),
      Options.withDefault("7d")
    ),
    prompt: optionalText("prompt", "kickoff prompt sent to the new Pi session"),
    setup: Options.text("setup").pipe(
      Options.withDescription("repository setup command run after provisioning; repeatable"),
      Options.repeated
    )
  },
  ({ base, branch, label, path, prompt, repo, setup, ttl }) =>
    Effect.gen(function* () {
      const created = yield* createEnvironment({
        repo,
        branch,
        ttl,
        setupCommands: setup,
        ...(Option.isSome(base) ? { base: base.value } : {}),
        ...(Option.isSome(path) ? { path: path.value } : {}),
        ...(Option.isSome(label) ? { label: label.value } : {}),
        ...(Option.isSome(prompt) ? { prompt: prompt.value } : {})
      })

      yield* Console.log("")
      yield* Console.log("worktree: ready")
      yield* Console.log(`  branch:     ${created.branch}`)
      yield* Console.log(`  base:       ${created.base}`)
      yield* Console.log(`  path:       ${created.path}`)
      yield* Console.log(`  workspace:  ${created.workspaceId}`)
      yield* Console.log(`  pi agent:   ${created.agentName}`)
      if (created.warnings.length > 0) {
        yield* Console.log(`  warnings:   ${created.warnings.length}`)
      }
    })
)

const root = Command.make("worktree", {}, () =>
  Console.log("worktree: run with --help to see available commands")
).pipe(
  Command.withDescription(
    "Create a provisioned Herdr Git worktree and launch a fresh Pi session.\n\n" +
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
