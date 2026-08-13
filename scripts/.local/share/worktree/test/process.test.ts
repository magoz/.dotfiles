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
