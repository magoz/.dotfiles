// Runs one condition check in its own process group. Output is discarded at the OS level.
// A check that runs past its timeout counts as false (`killed: true`); interruption (cancel,
// expiry, unload) terminates the whole group. Only a spawn failure is an error.
import { spawn } from "node:child_process"
import { Data, Deferred, Effect, Option } from "effect"
import type { Gate } from "./domain.ts"

const FORCE_KILL_DELAY = "1 second"

export interface CheckResult {
  readonly code: number
  readonly killed: boolean
}

export class CheckError extends Data.TaggedError("CheckError")<{ readonly message: string }> {}

/** The server's inherited Herdr pane identity is never the user's pane; conditions never see it. */
export const withoutPaneEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("HERDR_")))

export type RunCheck = (gate: Gate) => Effect.Effect<CheckResult, CheckError>

export function makeCheckRunner(env: NodeJS.ProcessEnv = process.env, shell = env.SHELL || "/bin/sh"): RunCheck {
  const childEnv = withoutPaneEnv(env)
  const exec = (gate: Gate) =>
    Effect.gen(function* () {
      const exited = yield* Deferred.make<CheckResult, CheckError>()
      const child = spawn(shell, ["-c", gate.command], { cwd: gate.cwd, env: childEnv, detached: true, stdio: "ignore" })
      const signalGroup = (signal: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, signal)
        } catch {
          /* the group is already gone */
        }
      }
      child.once("error", (error) => Deferred.doneUnsafe(exited, Effect.fail(new CheckError({ message: `could not start condition: ${error.message}` }))))
      child.once("exit", (code) => {
        // Reap descendants that outlived the leader; the leader's exit code is the verdict.
        signalGroup("SIGKILL")
        Deferred.doneUnsafe(exited, Effect.succeed({ code: code ?? 1, killed: false }))
      })
      // Interruption: SIGTERM the group, give it a moment, then SIGKILL whatever is left.
      return yield* Deferred.await(exited).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => signalGroup("SIGTERM")).pipe(
            Effect.andThen(Deferred.await(exited).pipe(Effect.ignore, Effect.timeoutOption(FORCE_KILL_DELAY))),
            Effect.andThen(Effect.sync(() => signalGroup("SIGKILL"))),
          ),
        ),
      )
    })
  return (gate) =>
    exec(gate).pipe(
      Effect.timeoutOption(gate.checkTimeoutMs),
      Effect.map(Option.getOrElse((): CheckResult => ({ code: 1, killed: true }))),
    )
}
