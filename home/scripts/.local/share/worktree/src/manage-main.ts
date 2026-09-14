#!/usr/bin/env bun
import { Effect } from "effect"
import { parseArgs } from "node:util"
import { ManagerError, WorktreeManager, type ManagerRunner } from "./manager"
import { Process, ProcessLive } from "./process"

const lifetime = new AbortController()
const cancel = () => lifetime.abort()
process.once("SIGINT", cancel)
process.once("SIGTERM", cancel)
const runner: ManagerRunner = (command, args, signal) => Effect.runPromise(
  Effect.gen(function* () {
    const service = yield* Process
    return yield* service.capture(command, args).pipe(
      Effect.map((r) => ({ code: 0, stdout: r.stdout })),
      Effect.catchTag("ProcessError", (r) => Effect.succeed({ code: r.exitCode, stdout: r.stdout })),
      Effect.timeout("60 seconds")
    )
  }).pipe(Effect.provide(ProcessLive)), { signal }
)

try {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: true,
    options: { cwd: { type: "string" }, path: { type: "string" }, workspace: { type: "string" },
      confirm: { type: "string" }, "expect-plan": { type: "string" }, "expect-releases": { type: "string" }, ttl: { type: "string" }, "delete-branch": { type: "boolean" }, help: { type: "boolean" } }
  })
  const command = positionals[0]
  if (values.help) {
    console.log("worktree-manage list --cwd SOURCE\nworktree-manage plan|renew|retire --cwd SOURCE --path CANONICAL_TARGET --workspace ID\nrenew: --ttl 7d; retire: --confirm CANONICAL_TARGET --expect-plan TOKEN_FROM_PLAN [--delete-branch]\nJSON output only. No automatic retries; inspect ~/.local/state/worktree-manager receipts.")
  } else {
    if (positionals.length !== 1 || !["list", "plan", "renew", "retire"].includes(command ?? "")) throw new ManagerError("Expected list, plan, renew, or retire")
    if (process.env.HERDR_ENV !== '1') throw new ManagerError('Run inside the intended Herdr pane')
    if (command === 'retire' && !/^[a-f0-9]{64}$/.test(values['expect-plan'] ?? '')) throw new ManagerError('Run plan first and provide its exact --expect-plan token')
    const manager = new WorktreeManager(runner)
    const cwd = values.cwd ?? process.cwd()
    if (command === "list") console.log(JSON.stringify(await manager.list(cwd, lifetime.signal)))
    else {
      if (!values.path || !values.workspace) throw new ManagerError("Exact --path and --workspace required")
      const target = { path: values.path, workspace: values.workspace }
      const result = command === "plan" ? await manager.plan(cwd, target, lifetime.signal)
        : command === "renew" ? await manager.renew(cwd, target, values.ttl ?? "7d", lifetime.signal)
        : await manager.retire(cwd, target, values.confirm ?? "", values["delete-branch"] ?? false, lifetime.signal,
          values["expect-releases"] === undefined ? undefined : values["expect-releases"] === "" ? [] : values["expect-releases"].split(","), values['expect-plan'])
      console.log(JSON.stringify(result))
    }
  }
} catch (error) {
  // Never serialize command output, parser diagnostics, env values or arbitrary exceptions.
  console.error("worktree-manage: " + (error instanceof ManagerError ? error.message : "Invalid request or operation interrupted; preserve resources and inspect receipts before retrying"))
  process.exitCode = 2
} finally {
  process.removeListener("SIGINT", cancel)
  process.removeListener("SIGTERM", cancel)
}
