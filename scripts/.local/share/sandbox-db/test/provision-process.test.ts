import { expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ProvisionProcess, ProvisionProcessLive } from "../src/provision-process"

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(25)
  }
  throw new Error("condition did not become true")
}

test("interrupt waits until the descendant process group has terminated", async () => {
  if (process.platform === "win32") return

  const directory = await mkdtemp(join(tmpdir(), "provision-process-"))
  const pidFile = join(directory, "child.pid")
  try {
    const fiber = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ProvisionProcess
        return yield* Effect.forkDaemon(
          service.capture("sh", [
            "-c",
            `sh -c 'trap "" TERM; while :; do sleep 1; done' & child=$!; printf '%s' "$child" > ${JSON.stringify(pidFile)}; wait`
          ])
        )
      }).pipe(Effect.provide(ProvisionProcessLive))
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
    const processState = Bun.spawnSync([
      "ps",
      "-o",
      "stat=",
      "-p",
      String(childPid)
    ]).stdout.toString().trim()

    expect(Number.isInteger(childPid)).toBe(true)
    expect(processState === "" || processState.startsWith("Z")).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
