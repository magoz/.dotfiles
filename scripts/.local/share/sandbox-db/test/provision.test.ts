import { expect, test } from "bun:test"
import { NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { provisionEnvironment } from "../src/provision"
import { ProvisionProcessError } from "../src/provision-domain"
import {
  ProvisionProcess,
  type ProvisionProcessService,
  type RunOptions
} from "../src/provision-process"

interface Call {
  readonly mode: "capture" | "inherit"
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
}

const processFailure = (command: string) =>
  new ProvisionProcessError({ command, exitCode: 1, stdout: "", stderr: "" })

const setup = async (
  failTestDatabase = false,
  existingDefault = false,
  failTestPull = false
) => {
  const repo = await mkdtemp(join(tmpdir(), "provision-env-"))
  await writeFile(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
  await mkdir(join(repo, ".vercel"), { recursive: true })
  await writeFile(join(repo, ".vercel", "project.json"), "{}\n")
  const calls: Array<Call> = []

  const capture: ProvisionProcessService["capture"] = (command, args, options: RunOptions = {}) => {
    calls.push({ mode: "capture", command, args, cwd: options.cwd })
    if (command === "git") {
      const gitArgs = args.slice(2)
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--is-inside-work-tree") {
        return Effect.succeed({ stdout: "true\n", stderr: "" })
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--show-toplevel") {
        return Effect.succeed({ stdout: `${repo}\n`, stderr: "" })
      }
      if (gitArgs[0] === "ls-files") return Effect.fail(processFailure("git ls-files"))
      if (gitArgs[0] === "check-ignore") {
        return Effect.succeed({ stdout: "", stderr: "" })
      }
      if (gitArgs[0] === "branch") {
        return Effect.succeed({ stdout: "feature/test-env\n", stderr: "" })
      }
    }
    if (command === "sandbox-db" && args[0] === "status") {
      const leaseIndex = args.indexOf("--lease")
      const leaseName = args[leaseIndex + 1]
      if (existingDefault && leaseName === "default") {
        return Effect.succeed({ stdout: '{"status":"live"}\n', stderr: "" })
      }
      return Effect.fail(processFailure("sandbox-db status"))
    }
    if (command === "sandbox-db" && args[0] === "create") {
      const leaseIndex = args.indexOf("--lease")
      const leaseName = args[leaseIndex + 1]
      if (failTestDatabase && leaseName === "test") {
        return Effect.fail(processFailure("sandbox-db create test"))
      }
      return Effect.succeed({
        stdout: JSON.stringify({
          status: existingDefault && leaseName === "default" ? "reused" : "created",
          branch_name: `agent/repo-${leaseName}`,
          branch_id: `branch-${leaseName}`
        }),
        stderr: ""
      })
    }
    if (command === "sandbox-db" && args[0] === "release") {
      return Effect.succeed({ stdout: "{}\n", stderr: "" })
    }
    return Effect.fail(processFailure(command))
  }

  const inherit: ProvisionProcessService["inherit"] = (command, args, options: RunOptions = {}) => {
    calls.push({ mode: "inherit", command, args, cwd: options.cwd })
    if (command === "pnpm") return Effect.void
    if (command === "vercel") {
      const file = args[2]!
      return Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeFile(
            file,
            [
              "SANDBOX_DB_NEON_API_KEY=key",
              "SANDBOX_DB_NEON_PROJECT_ID=project",
              "SANDBOX_DB_PARENT_BRANCH_ID=parent"
            ].join("\n") + "\n"
          )
        )
        if (failTestPull && args.includes("test")) {
          return yield* Effect.fail(processFailure("vercel env pull test"))
        }
      })
    }
    return Effect.fail(processFailure(command))
  }

  const layer = Layer.mergeAll(
    NodeContext.layer,
    Layer.succeed(ProvisionProcess, { capture, inherit })
  )
  return { repo, calls, layer }
}

const options = (repo: string) => ({
  repo,
  database: true,
  testEnvironment: "test",
  ttl: "7d",
  skipInstall: false,
  skipVercel: false
})

test("provisioning pulls both environments and creates independent database leases", async () => {
  const fixture = await setup()
  try {
    await Effect.runPromise(provisionEnvironment(options(fixture.repo)).pipe(Effect.provide(fixture.layer)))

    const inherited = fixture.calls.filter((call) => call.mode === "inherit")
    expect(inherited.map((call) => call.command)).toEqual(["pnpm", "vercel", "vercel"])

    const vercelCalls = inherited.filter((call) => call.command === "vercel")
    expect(vercelCalls[0]?.args).toContain("development")
    expect(vercelCalls[1]?.args).toContain("test")

    const databaseCalls = fixture.calls.filter(
      (call) => call.mode === "capture" && call.command === "sandbox-db" && call.args[0] === "create"
    )
    expect(databaseCalls[0]?.args).toContain("default")
    expect(databaseCalls[0]?.args).toContain(".env.local")
    expect(databaseCalls[1]?.args).toContain("test")
    expect(databaseCalls[1]?.args).toContain(".env.test")
    expect((await stat(join(fixture.repo, ".env.local"))).mode & 0o777).toBe(0o600)
    expect((await stat(join(fixture.repo, ".env.test"))).mode & 0o777).toBe(0o600)
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("a test database failure releases only the lease created by this run", async () => {
  const fixture = await setup(true)
  try {
    await expect(
      Effect.runPromise(provisionEnvironment(options(fixture.repo)).pipe(Effect.provide(fixture.layer)))
    ).rejects.toThrow()

    const releases = fixture.calls.filter(
      (call) => call.mode === "capture" && call.command === "sandbox-db" && call.args[0] === "release"
    )
    expect(releases.map((call) => call.args[call.args.indexOf("--lease") + 1])).toEqual([
      "default"
    ])
    await expect(stat(join(fixture.repo, ".env.local"))).rejects.toThrow()
    await expect(stat(join(fixture.repo, ".env.test"))).rejects.toThrow()
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("rollback preserves reused leases and restores existing env files", async () => {
  const fixture = await setup(true, true)
  const localContent = [
    "SANDBOX_DB_NEON_API_KEY=key",
    "SANDBOX_DB_NEON_PROJECT_ID=project",
    "SANDBOX_DB_PARENT_BRANCH_ID=parent",
    "DATABASE_URL=postgres://existing-development",
    "DATABASE_URL_UNPOOLED=postgres://existing-development-direct"
  ].join("\n") + "\n"
  const testContent = [
    "DATABASE_URL=postgres://existing-test",
    "DATABASE_URL_UNPOOLED=postgres://existing-test-direct"
  ].join("\n") + "\n"
  await writeFile(join(fixture.repo, ".env.local"), localContent, { mode: 0o600 })
  await writeFile(join(fixture.repo, ".env.test"), testContent, { mode: 0o600 })

  try {
    await expect(
      Effect.runPromise(
        provisionEnvironment({
          ...options(fixture.repo),
          skipInstall: true,
          skipVercel: true
        }).pipe(Effect.provide(fixture.layer))
      )
    ).rejects.toThrow()

    const releases = fixture.calls.filter(
      (call) => call.mode === "capture" && call.command === "sandbox-db" && call.args[0] === "release"
    )
    expect(releases).toHaveLength(0)
    expect(await readFile(join(fixture.repo, ".env.local"), "utf8")).toBe(localContent)
    expect(await readFile(join(fixture.repo, ".env.test"), "utf8")).toBe(testContent)
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("a failed Vercel pull leaves neither final nor temporary secret files", async () => {
  const fixture = await setup(false, false, true)
  try {
    await expect(
      Effect.runPromise(
        provisionEnvironment({
          ...options(fixture.repo),
          database: false
        }).pipe(Effect.provide(fixture.layer))
      )
    ).rejects.toThrow()

    await expect(stat(join(fixture.repo, ".env.local"))).rejects.toThrow()
    await expect(stat(join(fixture.repo, ".env.test"))).rejects.toThrow()
    await expect(
      stat(join(fixture.repo, ".vercel", ".env.local.provision-env.tmp"))
    ).rejects.toThrow()
    await expect(
      stat(join(fixture.repo, ".vercel", ".env.test.provision-env.tmp"))
    ).rejects.toThrow()
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})
