import { expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Process, ProcessLive } from "../src/process"

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(25)
  }
  throw new Error("condition did not become true")
}

test("interrupting a command terminates its descendant process group", async () => {
  if (process.platform === "win32") return

  const directory = await mkdtemp(join(tmpdir(), "worktree-process-"))
  const pidFile = join(directory, "child.pid")
  try {
    const fiber = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Process
        return yield* Effect.forkDaemon(
          service.capture("sh", [
            "-c",
            `sleep 30 & child=$!; printf '%s' "$child" > ${JSON.stringify(pidFile)}; wait`
          ])
        )
      }).pipe(Effect.provide(ProcessLive))
    )

    await waitFor(async () => {
      try {
        return (await readFile(pidFile, "utf8")).trim().length > 0
      } catch {
        return false
      }
    })
    const childPid = Number((await readFile(pidFile, "utf8")).trim())

    await Effect.runPromise(Fiber.interrupt(fiber))
    await waitFor(async () => {
      try {
        process.kill(childPid, 0)
        return false
      } catch {
        return true
      }
    })

    expect(Number.isInteger(childPid)).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

for (const mode of ["capture", "inherit"] satisfies ReadonlyArray<"capture" | "inherit">) {
  test(`${mode} interruption awaits SIGKILL even after leader exits with resistant descendant`, async () => {
    if (process.platform === "win32") return
    const directory = await mkdtemp(join(tmpdir(), "worktree-resistant-"))
    const pidFile = join(directory, "resistant.pid")
    const script = join(directory, "resistant.js")
    try {
      await Bun.write(script, `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`)
      const fiber = await Effect.runPromise(Effect.gen(function* () {
        const service = yield* Process
        return yield* Effect.forkDaemon(service[mode]("sh", ["-c", `${JSON.stringify(process.execPath)} ${JSON.stringify(script)} & wait`]))
      }).pipe(Effect.provide(ProcessLive)))
      await waitFor(async () => { try { return (await readFile(pidFile, "utf8")).length > 0 } catch { return false } })
      const pid = Number(await readFile(pidFile, "utf8"))
      const start = Date.now()
      await Effect.runPromise(Fiber.interrupt(fiber))
      expect(Date.now() - start).toBeGreaterThanOrEqual(1900)
      await waitFor(async () => {
        try {
          process.kill(pid, 0)
          // Linux containers may leave an orphan zombie until PID1 reaps it.
          return process.platform === "linux" && /\) Z /.test(await readFile(`/proc/${pid}/stat`, "utf8"))
        } catch { return true }
      })
    } finally { await rm(directory, { recursive: true, force: true }) }
  }, 8000)
}

test("manager CLI SIGTERM waits for its resistant detached command descendants", async () => {
  if (process.platform === "win32") return
  const directory = await mkdtemp(join(tmpdir(), "manager-cancel-"))
  const pidFile = join(directory, "resistant.pid")
  try {
    const script = join(directory, "resistant.js")
    await Bun.write(script, `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`)
    const herdr = join(directory, "herdr")
    await Bun.write(herdr, `#!/bin/sh\n${JSON.stringify(process.execPath)} ${JSON.stringify(script)} & wait\n`)
    const { chmod } = await import("node:fs/promises")
    await chmod(herdr, 0o700)
    const cli = Bun.spawn([process.execPath, join(import.meta.dir, "../src/manage-main.ts"), "list", "--cwd", directory], {
      env: { ...process.env, PATH: directory }, stdout: "pipe", stderr: "pipe",
    })
    await waitFor(async () => { try { return (await readFile(pidFile, "utf8")).length > 0 } catch { return false } })
    const pid = Number(await readFile(pidFile, "utf8"))
    const start = Date.now(); cli.kill("SIGTERM")
    expect(await cli.exited).toBe(2)
    expect(Date.now() - start).toBeGreaterThanOrEqual(1900)
    expect(await new Response(cli.stdout).text()).toBe("")
    await waitFor(async () => {
      try {
        process.kill(pid, 0)
        return process.platform === "linux" && /\) Z /.test(await readFile(`/proc/${pid}/stat`, "utf8"))
      } catch { return true }
    })
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 10000)
