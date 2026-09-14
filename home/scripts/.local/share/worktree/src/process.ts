import { Context, Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import { ProcessError } from "./domain"

export interface RunOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  /** Keep inherited child output off a machine-readable stdout channel. */
  readonly stdoutToStderr?: boolean
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

const terminateProcessTree = (child: ReturnType<typeof spawn>): Promise<void> => {
  const pid = child.pid
  if (pid === undefined) return Promise.resolve()
  const signal = (name: NodeJS.Signals) => {
    try {
      if (detached) process.kill(-pid, name)
      else child.kill(name)
    } catch {
      // The leader may exit while resistant descendants still own the group.
    }
  }
  signal("SIGTERM")
  // Referenced AND awaited: interruption cannot exit the CLI before SIGKILL.
  return new Promise((resolve) => {
    setTimeout(() => { signal("SIGKILL"); resolve() }, 2_000)
  })
}

const capture: ProcessService["capture"] = (command, args, options = {}) =>
  Effect.async<ProcessResult, ProcessError>((resume) => {
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
      resume(effect)
    }
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
    return Effect.promise(() => terminateProcessTree(child))
  })

const inherit: ProcessService["inherit"] = (command, args, options = {}) =>
  Effect.async<void, ProcessError>((resume) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      detached,
      stdio: options.stdoutToStderr ? ["inherit", 2, 2] : "inherit"
    })
    let settled = false

    const finish = (effect: Effect.Effect<void, ProcessError>) => {
      if (settled) return
      settled = true
      resume(effect)
    }
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
    return Effect.promise(() => terminateProcessTree(child))
  })

export const ProcessLive = Layer.succeed(Process, { capture, inherit })
