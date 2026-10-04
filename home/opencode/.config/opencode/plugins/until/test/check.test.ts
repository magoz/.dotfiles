import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { Effect, Fiber } from "effect"
import { makeCheckRunner } from "../check.ts"

const env = { PATH: process.env.PATH, HERDR_SOCKET: "server-pane", HOME: process.env.HOME }
const run = makeCheckRunner(env, "/bin/sh")

test("exit code is the verdict; cwd applies; output discarded; server Herdr identity hidden", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "until-check-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.deepEqual(await Effect.runPromise(run({ command: "echo noisy; exit 3", cwd: dir, checkTimeoutMs: 5000 })), { code: 3, killed: false })
  const probe = `test "$PWD" = "${dir}" && test -z "$HERDR_SOCKET"`
  assert.deepEqual(await Effect.runPromise(run({ command: probe, cwd: dir, checkTimeoutMs: 5000 })), { code: 0, killed: false })
})

test("a check past its timeout is terminated with its descendants and counts as false", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "until-check-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const marker = path.join(dir, "late")
  const started = Date.now()
  const result = await Effect.runPromise(run({ command: `(sleep 2; touch ${marker}) & sleep 5`, cwd: dir, checkTimeoutMs: 200 }))
  assert.deepEqual(result, { code: 1, killed: true })
  assert.ok(Date.now() - started < 3000)
  await new Promise((resolve) => setTimeout(resolve, 2200))
  await assert.rejects(readFile(marker), "the background descendant was killed with the group")
})

test("interruption terminates the group; a missing shell fails with a clear error", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "until-check-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const marker = path.join(dir, "survived")
  await Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(run({ command: `sleep 1; touch ${marker}`, cwd: dir, checkTimeoutMs: 10_000 }))
    yield* Effect.sleep("100 millis")
    yield* Fiber.interrupt(fiber)
  }))
  await new Promise((resolve) => setTimeout(resolve, 1500))
  await assert.rejects(readFile(marker))
  const missing = makeCheckRunner(env, "/nonexistent/shell")
  const error = await Effect.runPromise(Effect.flip(missing({ command: "true", cwd: tmpdir(), checkTimeoutMs: 1000 })))
  assert.match(error.message, /could not start condition/)
})
