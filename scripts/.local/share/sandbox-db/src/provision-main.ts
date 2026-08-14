#!/usr/bin/env bun
import { Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer, Option } from "effect"
import { ProvisionError, ProvisionProcessError } from "./provision-domain"
import { ProvisionProcessLive } from "./provision-process"
import { provisionEnvironment } from "./provision"

// Vercel inherits this mask, so staging files are private from their first write.
process.umask(0o077)

const optionalText = (name: string, description: string) =>
  Options.text(name).pipe(Options.withDescription(description), Options.optional)

const root = Command.make(
  "provision-env",
  {
    repo: Options.text("repo").pipe(
      Options.withDescription("target Git checkout (default: current directory)"),
      Options.withDefault(".")
    ),
    source: optionalText("source", "linked checkout to copy .vercel/project.json from"),
    vercelProject: optionalText("vercel-project", "link explicitly to this Vercel project"),
    database: Options.boolean("database").pipe(
      Options.withDescription("allocate independent development and test databases")
    ),
    testEnvironment: Options.text("test-environment").pipe(
      Options.withDescription("Vercel environment for .env.test (default: test)"),
      Options.withDefault("test")
    ),
    label: optionalText("label", "database label prefix (default: branch/directory)"),
    ttl: Options.text("ttl").pipe(
      Options.withDescription("database lifetime (default: 7d; maximum: 7d)"),
      Options.withDefault("7d")
    ),
    skipInstall: Options.boolean("skip-install").pipe(
      Options.withDescription("do not install dependencies")
    ),
    skipVercel: Options.boolean("skip-vercel").pipe(
      Options.withDescription("do not pull either Vercel environment")
    )
  },
  (options) =>
    provisionEnvironment({
      repo: options.repo,
      source: Option.getOrUndefined(options.source),
      vercelProject: Option.getOrUndefined(options.vercelProject),
      database: options.database,
      testEnvironment: options.testEnvironment,
      label: Option.getOrUndefined(options.label),
      ttl: options.ttl,
      skipInstall: options.skipInstall,
      skipVercel: options.skipVercel
    })
).pipe(
  Command.withDescription(
    "Install dependencies, pull Vercel Development and test environments, and optionally provision two isolated databases.\n\n" +
    "The command refuses to overwrite .env.local or .env.test. Both paths must be ignored.\n" +
    "Repository-specific schema bootstrap remains a separate step.\n\n" +
    "Documentation: ~/.local/share/sandbox-db/README.md"
  )
)

const cli = Command.run(root, { name: "provision-env", version: "2.0.0" })
const MainLayer = Layer.mergeAll(NodeContext.layer, ProvisionProcessLive)

Effect.suspend(() => cli(process.argv)).pipe(
  Effect.catchTags({
    ProvisionError: (error: ProvisionError) => failWith(error.message),
    ProvisionProcessError: (error: ProvisionProcessError) => failWith(error.message)
  }),
  Effect.provide(MainLayer),
  NodeRuntime.runMain
)

function failWith(message: string) {
  return Console.error(`provision-env: ${message}`).pipe(
    Effect.zipRight(
      Effect.sync(() => {
        process.exitCode = 2
      })
    )
  )
}
