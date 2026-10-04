import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"
import { Effect, Exit, Fiber } from "effect"
import { runProcess, withoutPaneEnv, type ProcessOptions } from "./process.ts"

const base: ProcessOptions = { cwd: process.cwd(), env: { PATH: "/bin:/usr/bin" }, timeout: "3 seconds" }
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.exit(effect))
const failure = (exit: Exit.Exit<unknown, { readonly message: string }>) =>
  Exit.isFailure(exit) ? exit.cause.reasons.map((reason) => (reason._tag === "Fail" ? reason.error.message : reason._tag)).join() : "success"

test("argv only, uncaptured output discarded, captured output capped", async () => {
  assert.deepEqual(withoutPaneEnv({ HERDR_ENV: "1", HERDR_SOCKET: "secret", PATH: "/bin" }), { PATH: "/bin" })
  assert.deepEqual(await Effect.runPromise(runProcess("/bin/sh", ["-c", "printf secret; printf secret >&2; exit 1"], base)), { code: 1, stdout: "", stderr: "" })
  assert.equal((await Effect.runPromise(runProcess("/bin/printf", ["%s", "literal; $(false)"], { ...base, capture: "stdout" }))).stdout, "literal; $(false)")
  assert.match(failure(await run(runProcess("/bin/sh", ["-c", "printf 123456789"], { ...base, capture: "stdout", maxBytes: 4 }))), /output exceeded/)
})

test("timeouts and spawn failures are bounded and sanitized", async () => {
  assert.match(failure(await run(runProcess("/bin/sh", ["-c", "sleep 30"], { ...base, timeout: "20 millis" }))), /timed out/)
  assert.match(failure(await run(runProcess("/not-a-real-command", [], base))), /Unable to start process/)
  assert.match(failure(await run(runProcess("/bin/true", [], { ...base, cleanupGraceMs: 10 }))), /Invalid cleanup grace/)
})

async function processes() {
  const result: Array<{ readonly pid: number; readonly state: string; readonly parent: number; readonly group: number; readonly command: string }> = []
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue
    try {
      const stat = await readFile(`/proc/${name}/stat`, "utf8")
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
      result.push({ pid: Number(name), state: fields[0] ?? "", parent: Number(fields[1]), group: Number(fields[2]), command: await readFile(`/proc/${name}/cmdline`, "utf8") })
    } catch {
      /* process already gone */
    }
  }
  return result
}

test("interruption waits the grace after leader exit and kills resistant descendants", { skip: process.platform !== "linux" }, async () => {
  const marker = `dotfiles-process-test-${randomUUID()}`
  await Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(
      runProcess("/bin/sh", ["-c", "sh -c 'trap \"\" TERM; while :; do sleep 1; done' & wait", marker], { ...base, timeout: "10 seconds" }),
    )
    let leader: number | undefined
    for (let attempt = 0; attempt < 100; attempt++) {
      const snapshot = yield* Effect.promise(processes)
      const found = snapshot.find((item) => item.command.includes(marker))
      const children = found ? snapshot.filter((item) => item.parent === found.pid) : []
      if (found && children[0] && snapshot.some((item) => item.parent === children[0]?.pid)) {
        leader = found.pid
        break
      }
      yield* Effect.sleep("10 millis")
    }
    assert.ok(leader)
    const start = Date.now()
    yield* Fiber.interrupt(fiber)
    assert.ok(Date.now() - start >= 240, "waited through the group SIGKILL grace after the leader terminated")
    yield* Effect.sleep("20 millis") // let /proc reflect exit transitions
    const remaining = (yield* Effect.promise(processes)).filter((item) => item.group === leader && item.state !== "Z")
    assert.deepEqual(remaining, [])
  }))
})
