// Effect process runner for the local Effect plugins: argv only (never a shell), its own process
// group, bounded captured output, sanitized errors. Interruption and timeout SIGTERM the group;
// after every run, even a clean exit, the group gets `cleanupGraceMs` and a final SIGKILL, so
// resistant descendants of a leader that already exited are reaped too.
// The plain-JS TUI plugins use ./process.js, which has the same contract.
import { spawn } from "node:child_process"
import { Data, Deferred, Duration, Effect, Option } from "effect"

export class ProcessError extends Data.TaggedError("ProcessError")<{ readonly message: string }> {}

export type Capture = "none" | "stdout" | "both"

export interface ProcessOptions {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly timeout: Duration.Input
  readonly capture?: Capture
  readonly maxBytes?: number
  /** Wait after SIGTERM before the final group SIGKILL (250ms–10s). */
  readonly cleanupGraceMs?: number
}

export interface ProcessResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/** The server's inherited Herdr pane identity is never the user's pane; children never see it. */
export const withoutPaneEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("HERDR_")))

export const runProcess = (command: string, args: readonly string[], options: ProcessOptions): Effect.Effect<ProcessResult, ProcessError> =>
  Effect.gen(function* () {
    if (process.platform === "win32") return yield* new ProcessError({ message: "POSIX process groups required" })
    const grace = options.cleanupGraceMs ?? 250
    if (!Number.isInteger(grace) || grace < 250 || grace > 10_000) return yield* new ProcessError({ message: "Invalid cleanup grace" })
    const capture = options.capture ?? "none"
    const maxBytes = options.maxBytes ?? 65_536
    const exited = yield* Deferred.make<number | null, ProcessError>()
    let stdout = ""
    let stderr = ""
    let bytes = 0

    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        spawn(command, [...args], {
          cwd: options.cwd,
          env: options.env,
          detached: true,
          stdio: ["ignore", capture === "none" ? "ignore" : "pipe", capture === "both" ? "pipe" : "ignore"],
        }),
      ),
      (child) =>
        Effect.gen(function* () {
          const collect = (channel: "stdout" | "stderr") => (data: Buffer) => {
            bytes += data.length
            if (bytes > maxBytes) {
              Deferred.doneUnsafe(exited, Effect.fail(new ProcessError({ message: "Process output exceeded limit" })))
              return
            }
            if (channel === "stdout") stdout += data.toString()
            else stderr += data.toString()
          }
          child.stdout?.on("data", collect("stdout"))
          child.stderr?.on("data", collect("stderr"))
          child.once("error", () => Deferred.doneUnsafe(exited, Effect.fail(new ProcessError({ message: "Unable to start process" }))))
          child.once("close", (code) => Deferred.doneUnsafe(exited, Effect.succeed(code)))
          const code = yield* Deferred.await(exited).pipe(
            Effect.timeoutOption(options.timeout),
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(new ProcessError({ message: "Process timed out; inspect partial resources before retrying" })),
                onSome: Effect.succeed,
              }),
            ),
          )
          return { code, stdout, stderr }
        }),
      (child) =>
        Effect.gen(function* () {
          child.stdout?.destroy()
          child.stderr?.destroy()
          const pid = child.pid
          if (pid === undefined) return
          const signalGroup = (signal: NodeJS.Signals) =>
            Effect.sync(() => {
              try {
                process.kill(-pid, signal)
              } catch {
                /* the group is already gone */
              }
            })
          yield* signalGroup("SIGTERM")
          yield* Effect.sleep(grace)
          yield* signalGroup("SIGKILL")
        }),
    )
  })
