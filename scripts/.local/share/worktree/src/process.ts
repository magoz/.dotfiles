import { Context, Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import { ProcessError } from "./domain"

export interface RunOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

export interface ProcessResult {
  readonly stdout: string
  readonly stderr: string
}

export interface ProcessService {
  readonly capture: (
    command: string,
    args: ReadonlyArray<string>,
    options?: RunOptions
  ) => Effect.Effect<ProcessResult, ProcessError>
  readonly inherit: (
    command: string,
    args: ReadonlyArray<string>,
    options?: RunOptions
  ) => Effect.Effect<void, ProcessError>
}

export const Process = Context.GenericTag<ProcessService>("worktree/Process")

const displayCommand = (command: string, args: ReadonlyArray<string>) =>
  [command, ...args].map((part) => JSON.stringify(part)).join(" ")

const detached = process.platform !== "win32"

const terminateProcessTree = (child: ReturnType<typeof spawn>) => {
  if (child.pid === undefined) return undefined
  const signal = (name: NodeJS.Signals) => {
    try {
      if (detached) process.kill(-child.pid!, name)
      else child.kill(name)
    } catch {
      // The process may have exited between the state check and the signal.
    }
  }
  signal("SIGTERM")
  const timer = setTimeout(() => signal("SIGKILL"), 2_000)
  timer.unref()
  return timer
}

const capture: ProcessService["capture"] = (command, args, options = {}) =>
  Effect.async<ProcessResult, ProcessError>((resume, signal) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      detached,
      stdio: ["ignore", "pipe", "pipe"]
    })
    let stdout = ""
    let stderr = ""
    let settled = false

    const finish = (effect: Effect.Effect<ProcessResult, ProcessError>) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", abort)
      resume(effect)
    }
    const abort = () => {
      terminateProcessTree(child)
    }

    signal.addEventListener("abort", abort, { once: true })
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      finish(
        Effect.fail(
          new ProcessError({
            command: displayCommand(command, args),
            exitCode: null,
            stdout,
            stderr: stderr || error.message
          })
        )
      )
    })
    child.on("close", (code) => {
      if (code === 0) {
        finish(Effect.succeed({ stdout, stderr }))
        return
      }
      finish(
        Effect.fail(
          new ProcessError({
            command: displayCommand(command, args),
            exitCode: code,
            stdout,
            stderr
          })
        )
      )
    })
  })

const inherit: ProcessService["inherit"] = (command, args, options = {}) =>
  Effect.async<void, ProcessError>((resume, signal) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      detached,
      stdio: "inherit"
    })
    let settled = false

    const finish = (effect: Effect.Effect<void, ProcessError>) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", abort)
      resume(effect)
    }
    const abort = () => {
      terminateProcessTree(child)
    }

    signal.addEventListener("abort", abort, { once: true })
    child.on("error", (error) => {
      finish(
        Effect.fail(
          new ProcessError({
            command: displayCommand(command, args),
            exitCode: null,
            stdout: "",
            stderr: error.message
          })
        )
      )
    })
    child.on("close", (code) => {
      if (code === 0) {
        finish(Effect.void)
        return
      }
      finish(
        Effect.fail(
          new ProcessError({
            command: displayCommand(command, args),
            exitCode: code,
            stdout: "",
            stderr: ""
          })
        )
      )
    })
  })

export const ProcessLive = Layer.succeed(Process, { capture, inherit })
