import { Context, Effect, Layer } from "effect"
import { spawn, type ChildProcess } from "node:child_process"
import { ProvisionProcessError } from "./provision-domain"

export interface RunOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

export interface ProcessResult {
  readonly stdout: string
  readonly stderr: string
}

export interface ProvisionProcessService {
  readonly capture: (
    command: string,
    args: ReadonlyArray<string>,
    options?: RunOptions
  ) => Effect.Effect<ProcessResult, ProvisionProcessError>
  readonly inherit: (
    command: string,
    args: ReadonlyArray<string>,
    options?: RunOptions
  ) => Effect.Effect<void, ProvisionProcessError>
}

export const ProvisionProcess = Context.GenericTag<ProvisionProcessService>(
  "sandbox-db/ProvisionProcess"
)

const displayCommand = (command: string, args: ReadonlyArray<string>) =>
  [command, ...args].map((part) => JSON.stringify(part)).join(" ")

const detached = process.platform !== "win32"

const signalProcessTree = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (child.pid === undefined) return
  try {
    if (detached) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    // The process group may already be gone.
  }
}

const processTreeIsAlive = (child: ChildProcess) => {
  if (child.pid === undefined) return false
  if (!detached) return child.exitCode === null && child.signalCode === null
  try {
    process.kill(-child.pid, 0)
    return true
  } catch {
    return false
  }
}

/** Finalizer: terminate the entire process group and do not return until it is gone. */
const terminateAndWait = (child: ChildProcess) =>
  Effect.async<void>((resume) => {
    let completed = false
    let forced = false
    const startedAt = Date.now()
    const finish = () => {
      if (completed) return
      completed = true
      clearInterval(poll)
      resume(Effect.void)
    }
    const inspect = () => {
      if (!processTreeIsAlive(child)) {
        finish()
        return
      }
      if (!forced && Date.now() - startedAt >= 2_000) {
        forced = true
        signalProcessTree(child, "SIGKILL")
      }
    }

    signalProcessTree(child, "SIGTERM")
    const poll = setInterval(inspect, 20)
    poll.unref()
    inspect()
  })

const spawnChild = (
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions,
  stdio: "inherit" | ["ignore", "pipe", "pipe"]
) =>
  Effect.sync(() =>
    spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      detached,
      stdio
    })
  )

const capture: ProvisionProcessService["capture"] = (command, args, options = {}) =>
  Effect.acquireUseRelease(
    spawnChild(command, args, options, ["ignore", "pipe", "pipe"]),
    (child) =>
      Effect.async<ProcessResult, ProvisionProcessError>((resume) => {
        let stdout = ""
        let stderr = ""
        let settled = false
        child.stdout!.setEncoding("utf8")
        child.stderr!.setEncoding("utf8")

        const finish = (effect: Effect.Effect<ProcessResult, ProvisionProcessError>) => {
          if (settled) return
          settled = true
          resume(effect)
        }
        const onStdout = (chunk: string) => {
          stdout += chunk
        }
        const onStderr = (chunk: string) => {
          stderr += chunk
        }
        const onError = (error: Error) => {
          finish(
            Effect.fail(
              new ProvisionProcessError({
                command: displayCommand(command, args),
                exitCode: null,
                stdout,
                stderr: stderr || error.message
              })
            )
          )
        }
        const onClose = (code: number | null) => {
          finish(
            code === 0
              ? Effect.succeed({ stdout, stderr })
              : Effect.fail(
                  new ProvisionProcessError({
                    command: displayCommand(command, args),
                    exitCode: code,
                    stdout,
                    stderr
                  })
                )
          )
        }

        child.stdout!.on("data", onStdout)
        child.stderr!.on("data", onStderr)
        child.once("error", onError)
        child.once("close", onClose)

        return Effect.sync(() => {
          child.stdout!.removeListener("data", onStdout)
          child.stderr!.removeListener("data", onStderr)
          child.removeListener("error", onError)
          child.removeListener("close", onClose)
        })
      }),
    terminateAndWait
  )

const inherit: ProvisionProcessService["inherit"] = (command, args, options = {}) =>
  Effect.acquireUseRelease(
    spawnChild(command, args, options, "inherit"),
    (child) =>
      Effect.async<void, ProvisionProcessError>((resume) => {
        let settled = false
        const finish = (effect: Effect.Effect<void, ProvisionProcessError>) => {
          if (settled) return
          settled = true
          resume(effect)
        }
        const onError = (error: Error) => {
          finish(
            Effect.fail(
              new ProvisionProcessError({
                command: displayCommand(command, args),
                exitCode: null,
                stdout: "",
                stderr: error.message
              })
            )
          )
        }
        const onClose = (code: number | null) => {
          finish(
            code === 0
              ? Effect.void
              : Effect.fail(
                  new ProvisionProcessError({
                    command: displayCommand(command, args),
                    exitCode: code,
                    stdout: "",
                    stderr: ""
                  })
                )
          )
        }

        child.once("error", onError)
        child.once("close", onClose)
        return Effect.sync(() => {
          child.removeListener("error", onError)
          child.removeListener("close", onClose)
        })
      }),
    terminateAndWait
  )

export const ProvisionProcessLive = Layer.succeed(ProvisionProcess, { capture, inherit })
