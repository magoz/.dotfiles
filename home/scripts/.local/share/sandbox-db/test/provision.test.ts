import { expect, test } from "bun:test"
import { NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { provisionEnvironment, stripPulledEnvironment } from "../src/provision"
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

const processFailure = (command: string, stdout = "") =>
  new ProvisionProcessError({ command, exitCode: 1, stdout, stderr: "" })

const setup = async (
  failTestDatabase = false,
  existingDefault = false,
  failTestPull = false,
  targetLinked = true,
  failStatusVerification = false,
  concurrentEnvChange = false,
  failRelease = false,
  existingTest = false
) => {
  const repo = await mkdtemp(join(tmpdir(), "provision-env-"))
  const primary = join(repo, "primary")
  const sibling = join(repo, "sibling")
  await writeFile(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
  await mkdir(join(repo, ".vercel"), { recursive: true })
  if (targetLinked) await writeFile(join(repo, ".vercel", "project.json"), "{}\n")
  const projectIdentity = '{"projectId":"primary","orgId":"team"}\n'
  await mkdir(join(primary, ".vercel"), { recursive: true })
  await writeFile(join(primary, ".vercel", "project.json"), projectIdentity)
  await mkdir(join(sibling, ".vercel"), { recursive: true })
  await writeFile(join(sibling, ".vercel", "project.json"), projectIdentity)
  const calls: Array<Call> = []

  const capture: ProvisionProcessService["capture"] = (command, args, options: RunOptions = {}) => {
    calls.push({ mode: "capture", command, args, cwd: options.cwd })
    if (command === "git") {
      const gitCwd = args[1]!
      const gitArgs = args.slice(2)
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--is-inside-work-tree") {
        return Effect.succeed({ stdout: "true\n", stderr: "" })
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--show-toplevel") {
        return Effect.succeed({ stdout: `${gitCwd}\n`, stderr: "" })
      }
      if (gitArgs[0] === "rev-parse" && gitArgs[1] === "--git-path") {
        return Effect.succeed({ stdout: `${repo}/.vercel/provision-env.lock\n`, stderr: "" })
      }
      if (gitArgs[0] === "worktree" && gitArgs[1] === "list") {
        return Effect.succeed({
          stdout: `worktree ${primary}\nHEAD abc123\nbranch refs/heads/main\n\nworktree ${sibling}\nHEAD bcd234\nbranch refs/heads/sibling\n\nworktree ${repo}\nHEAD def456\nbranch refs/heads/feature\n`,
          stderr: ""
        })
      }
      if (gitArgs[0] === "ls-files") return Effect.fail(processFailure("git ls-files"))
      if (gitArgs[0] === "check-ignore") {
        return Effect.succeed({ stdout: "", stderr: "" })
      }
      if (gitArgs[0] === "branch") {
        return Effect.succeed({ stdout: "feature/test-env\n", stderr: "" })
      }
    }
    if (command === "vercel" && args[0] === "env" && args[1] === "list") {
      return Effect.succeed({
        stdout: [
          " name               value       environments",
          " APP_SETTING        Encrypted   Development, test",
          " DATABASE_URL       Encrypted   Development, test",
          " DATABASE_URL_UNPOOLED Encrypted Development, test",
          " TURBO_CACHE        Encrypted   test",
          " VERCEL_API_TOKEN   Encrypted   Development, test"
        ].join("\n"),
        stderr: ""
      })
    }
    if (command === "sandbox-db" && args[0] === "status") {
      if (failStatusVerification) {
        return Effect.fail(processFailure("sandbox-db status unavailable"))
      }
      const leaseIndex = args.indexOf("--lease")
      const leaseName = args[leaseIndex + 1]
      if (
        (existingDefault && leaseName === "default") ||
        (existingTest && leaseName === "test")
      ) {
        return Effect.succeed({ stdout: '{"status":"live"}\n', stderr: "" })
      }
      return Effect.fail(
        processFailure(
          "sandbox-db status",
          JSON.stringify({ status: "none", lease: leaseName, worktree: repo })
        )
      )
    }
    if (command === "sandbox-db" && args[0] === "create") {
      const leaseIndex = args.indexOf("--lease")
      const leaseName = args[leaseIndex + 1]
      if (failTestDatabase && leaseName === "test") {
        return Effect.fail(processFailure("sandbox-db create test"))
      }
      const status =
        (existingDefault && leaseName === "default") ||
        (existingTest && leaseName === "test")
          ? "reused"
          : "created"
      return Effect.gen(function* () {
        const envIndex = args.indexOf("--env-file")
        const envFile = join(repo, args[envIndex + 1]!)
        const current = yield* Effect.promise(() => readFile(envFile, "utf8").catch(() => ""))
        if (!/^DATABASE_URL=/m.test(current) || !/^DATABASE_URL_UNPOOLED=/m.test(current)) {
          yield* Effect.promise(() =>
            writeFile(
              envFile,
              `${current.trimEnd()}\nDATABASE_URL=postgres://sandbox-${leaseName}\nDATABASE_URL_UNPOOLED=postgres://sandbox-${leaseName}-direct\n`,
              { mode: 0o600 }
            )
          )
        }
        return {
          stdout: JSON.stringify({
            status,
            branch_name: `agent/repo-${leaseName}`,
            branch_id: `branch-${leaseName}`
          }),
          stderr: ""
        }
      })
    }
    if (command === "sandbox-db" && args[0] === "release") {
      return failRelease
        ? Effect.fail(processFailure("sandbox-db release unavailable"))
        : Effect.succeed({ stdout: "{}\n", stderr: "" })
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
              "# Created by Vercel CLI",
              "DATABASE_URL=postgres://vercel-pooled",
              "DATABASE_URL_UNPOOLED=postgres://vercel-direct",
              "SANDBOX_DB_NEON_API_KEY=key",
              "SANDBOX_DB_NEON_PROJECT_ID=project",
              "SANDBOX_DB_PARENT_BRANCH_ID=parent",
              "APP_SETTING=keep",
              "VERCEL_API_TOKEN=explicit-app-value",
              "VERCEL_OIDC_TOKEN=generated-oidc",
              ...(args.includes("test")
                ? [
                    "NX_DAEMON=false",
                    "TURBO_CACHE=remote:rw",
                    "VERCEL=1",
                    "VERCEL_ENV=preview",
                    "VERCEL_GIT_COMMIT_AUTHOR_NAME=Test Author",
                    "VERCEL_GIT_COMMIT_SHA=abc123",
                    "VERCEL_TARGET_ENV=test",
                    "VERCEL_URL=test.example.vercel.app"
                  ]
                : [])
            ].join("\n") + "\n"
          )
        )
        if (failTestPull && args.includes("test")) {
          return yield* Effect.fail(processFailure("vercel env pull test"))
        }
        if (concurrentEnvChange && args.includes("test")) {
          yield* Effect.promise(() =>
            writeFile(join(repo, ".env.local"), "CONCURRENT_CHANGE=keep\n", { mode: 0o600 })
          )
        }
      })
    }
    return Effect.fail(processFailure(command))
  }

  const layer = Layer.mergeAll(
    NodeContext.layer,
    Layer.succeed(ProvisionProcess, { capture, inherit })
  )
  return { repo, primary, sibling, calls, layer }
}

const options = (repo: string) => ({
  repo,
  database: true,
  testEnvironment: "test",
  ttl: "7d",
  skipInstall: false,
  skipVercel: false,
  nonInteractive: true,
  envConflict: "error" as const
})

test("Vercel database URLs remain when sandbox allocation is not requested", () => {
  const pulled = "DATABASE_URL=postgres://vercel-pooled\nDATABASE_URL_UNPOOLED=postgres://vercel-direct\n"
  const result = stripPulledEnvironment(
    pulled,
    new Set(["DATABASE_URL", "DATABASE_URL_UNPOOLED"]),
    false
  )

  expect(result.content).toBe(pulled)
  expect(result.databaseUrlsRemoved).toBe(0)
})

test("an unlinked worktree reuses the shared sibling Vercel identity", async () => {
  const fixture = await setup(false, false, false, false)
  try {
    await Effect.runPromise(
      provisionEnvironment({
        ...options(fixture.repo),
        database: false,
        skipInstall: true
      }).pipe(Effect.provide(fixture.layer))
    )

    expect(await readFile(join(fixture.repo, ".vercel", "project.json"), "utf8")).toBe(
      '{"projectId":"primary","orgId":"team"}\n'
    )
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
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
    const localEnvironment = await readFile(join(fixture.repo, ".env.local"), "utf8")
    const testEnvironment = await readFile(join(fixture.repo, ".env.test"), "utf8")
    expect(localEnvironment).toContain("APP_SETTING=keep")
    expect(localEnvironment).not.toContain("postgres://vercel-")
    expect(localEnvironment).toContain("VERCEL_API_TOKEN=explicit-app-value")
    expect(localEnvironment).not.toContain("VERCEL_OIDC_TOKEN")
    expect(testEnvironment).toContain("APP_SETTING=keep")
    expect(testEnvironment).not.toContain("postgres://vercel-")
    expect(testEnvironment).toContain("VERCEL_API_TOKEN=explicit-app-value")
    expect(testEnvironment).not.toContain("VERCEL=1")
    expect(testEnvironment).not.toContain("VERCEL_GIT_")
    expect(testEnvironment).not.toContain("VERCEL_ENV=")
    expect(testEnvironment).not.toContain("VERCEL_URL=")
    expect(testEnvironment).not.toContain("NX_DAEMON=")
    expect(testEnvironment).toContain("TURBO_CACHE=remote:rw")
    expect((await stat(join(fixture.repo, ".env.local"))).mode & 0o777).toBe(0o600)
    expect((await stat(join(fixture.repo, ".env.test"))).mode & 0o777).toBe(0o600)
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("missing env files are restored from Vercel and matching live leases", async () => {
  const fixture = await setup(false, true, false, true, false, false, false, true)
  try {
    await Effect.runPromise(
      provisionEnvironment(options(fixture.repo)).pipe(Effect.provide(fixture.layer))
    )

    const creates = fixture.calls.filter(
      (call) => call.mode === "capture" && call.command === "sandbox-db" && call.args[0] === "create"
    )
    expect(creates.map((call) => call.args[call.args.indexOf("--lease") + 1])).toEqual([
      "default",
      "test"
    ])
    expect(await readFile(join(fixture.repo, ".env.local"), "utf8")).toContain(
      "DATABASE_URL=postgres://sandbox-default"
    )
    expect(await readFile(join(fixture.repo, ".env.test"), "utf8")).toContain(
      "DATABASE_URL=postgres://sandbox-test"
    )
    expect(
      fixture.calls.filter(
        (call) => call.mode === "capture" && call.command === "sandbox-db" && call.args[0] === "release"
      )
    ).toHaveLength(0)
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("a checkout lock rejects concurrent provisioning", async () => {
  const fixture = await setup()
  await mkdir(join(fixture.repo, ".vercel", "provision-env.lock"))

  try {
    await expect(
      Effect.runPromise(
        provisionEnvironment({
          ...options(fixture.repo),
          database: false,
          skipInstall: true
        }).pipe(Effect.provide(fixture.layer))
      )
    ).rejects.toThrow("another provision-env process")
    expect(fixture.calls.filter((call) => call.mode === "inherit")).toHaveLength(0)
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("non-interactive env conflicts fail before making changes", async () => {
  const fixture = await setup()
  const localContent = "EXISTING_LOCAL=keep\n"
  const testContent = "EXISTING_TEST=keep\n"
  await writeFile(join(fixture.repo, ".env.local"), localContent, { mode: 0o600 })
  await writeFile(join(fixture.repo, ".env.test"), testContent, { mode: 0o600 })

  try {
    await expect(
      Effect.runPromise(
        provisionEnvironment({
          ...options(fixture.repo),
          database: false,
          nonInteractive: true,
          envConflict: "ask"
        }).pipe(Effect.provide(fixture.layer))
      )
    ).rejects.toThrow("prompting is unavailable")

    expect(fixture.calls.filter((call) => call.mode === "inherit")).toHaveLength(0)
    expect(await readFile(join(fixture.repo, ".env.local"), "utf8")).toBe(localContent)
    expect(await readFile(join(fixture.repo, ".env.test"), "utf8")).toBe(testContent)
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("explicit env conflict policies preserve or overwrite both files", async () => {
  const preserveFixture = await setup()
  const overwriteFixture = await setup()
  for (const fixture of [preserveFixture, overwriteFixture]) {
    await writeFile(join(fixture.repo, ".env.local"), "EXISTING_LOCAL=keep\n", { mode: 0o600 })
    await writeFile(join(fixture.repo, ".env.test"), "EXISTING_TEST=keep\n", { mode: 0o600 })
  }

  try {
    await Effect.runPromise(
      provisionEnvironment({
        ...options(preserveFixture.repo),
        database: false,
        skipInstall: true,
        envConflict: "preserve"
      }).pipe(Effect.provide(preserveFixture.layer))
    )
    expect(await readFile(join(preserveFixture.repo, ".env.local"), "utf8")).toBe(
      "EXISTING_LOCAL=keep\n"
    )
    expect(
      preserveFixture.calls.filter((call) => call.mode === "inherit" && call.command === "vercel")
    ).toHaveLength(0)

    await Effect.runPromise(
      provisionEnvironment({
        ...options(overwriteFixture.repo),
        database: false,
        skipInstall: true,
        envConflict: "overwrite"
      }).pipe(Effect.provide(overwriteFixture.layer))
    )
    expect(await readFile(join(overwriteFixture.repo, ".env.local"), "utf8")).toContain(
      "APP_SETTING=keep"
    )
    expect(await readFile(join(overwriteFixture.repo, ".env.local"), "utf8")).not.toContain(
      "EXISTING_LOCAL"
    )
  } finally {
    await rm(preserveFixture.repo, { recursive: true, force: true })
    await rm(overwriteFixture.repo, { recursive: true, force: true })
  }
})

test("overwrite refreshes Vercel env and reuses live database leases", async () => {
  const fixture = await setup(false, true, false, true, false, false, false, true)
  await writeFile(
    join(fixture.repo, ".env.local"),
    "STALE_LOCAL=remove\nDATABASE_URL=postgres://existing\nDATABASE_URL_UNPOOLED=postgres://existing-direct\n",
    { mode: 0o600 }
  )
  await writeFile(
    join(fixture.repo, ".env.test"),
    "STALE_TEST=remove\nDATABASE_URL=postgres://existing-test\nDATABASE_URL_UNPOOLED=postgres://existing-test-direct\n",
    { mode: 0o600 }
  )

  try {
    await Effect.runPromise(
      provisionEnvironment({
        ...options(fixture.repo),
        skipInstall: true,
        envConflict: "overwrite"
      }).pipe(Effect.provide(fixture.layer))
    )

    const local = await readFile(join(fixture.repo, ".env.local"), "utf8")
    const testEnvironment = await readFile(join(fixture.repo, ".env.test"), "utf8")
    expect(local).not.toContain("STALE_LOCAL")
    expect(testEnvironment).not.toContain("STALE_TEST")
    expect(local).toContain("DATABASE_URL=postgres://sandbox-default")
    expect(testEnvironment).toContain("DATABASE_URL=postgres://sandbox-test")
    expect(
      fixture.calls.filter(
        (call) => call.mode === "capture" && call.command === "sandbox-db" && call.args[0] === "release"
      )
    ).toHaveLength(0)
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("env refresh keeps existing database URLs when allocation is skipped", async () => {
  const fixture = await setup()
  await writeFile(
    join(fixture.repo, ".env.local"),
    "DATABASE_URL=postgres://existing-local\nDATABASE_URL_UNPOOLED=postgres://existing-local-direct\n",
    { mode: 0o600 }
  )
  await writeFile(
    join(fixture.repo, ".env.test"),
    "DATABASE_URL=postgres://existing-test\nDATABASE_URL_UNPOOLED=postgres://existing-test-direct\n",
    { mode: 0o600 }
  )

  try {
    await Effect.runPromise(
      provisionEnvironment({
        ...options(fixture.repo),
        database: false,
        skipInstall: true,
        envConflict: "overwrite"
      }).pipe(Effect.provide(fixture.layer))
    )

    expect(await readFile(join(fixture.repo, ".env.local"), "utf8")).toContain(
      "DATABASE_URL=postgres://existing-local"
    )
    expect(await readFile(join(fixture.repo, ".env.test"), "utf8")).toContain(
      "DATABASE_URL=postgres://existing-test"
    )
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("env refresh does not consult lease status when databases are skipped", async () => {
  const fixture = await setup(false, false, false, true, true)
  await writeFile(join(fixture.repo, ".env.local"), "EXISTING_LOCAL=remove\n", { mode: 0o600 })
  await writeFile(join(fixture.repo, ".env.test"), "EXISTING_TEST=remove\n", { mode: 0o600 })

  try {
    await Effect.runPromise(
      provisionEnvironment({
        ...options(fixture.repo),
        database: false,
        skipInstall: true,
        envConflict: "overwrite"
      }).pipe(Effect.provide(fixture.layer))
    )

    expect(await readFile(join(fixture.repo, ".env.local"), "utf8")).not.toContain(
      "EXISTING_LOCAL"
    )
    expect(
      fixture.calls.filter(
        (call) => call.mode === "capture" && call.command === "sandbox-db" && call.args[0] === "status"
      )
    ).toHaveLength(0)
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("database allocation delegates lease decisions directly to create", async () => {
  const fixture = await setup(false, false, false, true, true)
  try {
    await Effect.runPromise(
      provisionEnvironment({
        ...options(fixture.repo),
        skipInstall: true,
        skipVercel: true
      }).pipe(Effect.provide(fixture.layer))
    )

    expect(
      fixture.calls.filter(
        (call) => call.mode === "capture" && call.command === "sandbox-db" && call.args[0] === "status"
      )
    ).toHaveLength(0)
    expect((await stat(join(fixture.repo, ".env.local"))).isFile()).toBe(true)
    expect((await stat(join(fixture.repo, ".env.test"))).isFile()).toBe(true)
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("rollback removes only the env file successfully created by a lease", async () => {
  const fixture = await setup(true)
  try {
    await expect(
      Effect.runPromise(
        provisionEnvironment({
          ...options(fixture.repo),
          skipInstall: true,
          skipVercel: true
        }).pipe(Effect.provide(fixture.layer))
      )
    ).rejects.toThrow("sandbox-db create test")

    await expect(stat(join(fixture.repo, ".env.local"))).rejects.toThrow()
    await expect(stat(join(fixture.repo, ".env.test"))).rejects.toThrow()
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("overwrite refuses concurrent env changes without restoring a stale snapshot", async () => {
  const fixture = await setup(false, false, false, true, false, true)
  await writeFile(join(fixture.repo, ".env.local"), "EXISTING_LOCAL=old\n", { mode: 0o600 })
  await writeFile(join(fixture.repo, ".env.test"), "EXISTING_TEST=keep\n", { mode: 0o600 })

  try {
    await expect(
      Effect.runPromise(
        provisionEnvironment({
          ...options(fixture.repo),
          database: false,
          skipInstall: true,
          envConflict: "overwrite"
        }).pipe(Effect.provide(fixture.layer))
      )
    ).rejects.toThrow("changed while provisioning")

    expect(await readFile(join(fixture.repo, ".env.local"), "utf8")).toBe(
      "CONCURRENT_CHANGE=keep\n"
    )
    expect(await readFile(join(fixture.repo, ".env.test"), "utf8")).toBe(
      "EXISTING_TEST=keep\n"
    )
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

test("a failed lease release does not prevent env rollback", async () => {
  const fixture = await setup(true, false, false, true, false, false, true)
  try {
    await expect(
      Effect.runPromise(provisionEnvironment(options(fixture.repo)).pipe(Effect.provide(fixture.layer)))
    ).rejects.toThrow("sandbox-db release unavailable")

    await expect(stat(join(fixture.repo, ".env.local"))).rejects.toThrow()
    await expect(stat(join(fixture.repo, ".env.test"))).rejects.toThrow()
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("rollback restores existing env files modified by a newly created lease", async () => {
  const fixture = await setup(true)
  const localContent = [
    "SANDBOX_DB_NEON_API_KEY=key",
    "SANDBOX_DB_NEON_PROJECT_ID=project",
    "SANDBOX_DB_PARENT_BRANCH_ID=parent",
    "ORIGINAL_LOCAL=keep"
  ].join("\n") + "\n"
  const testContent = "ORIGINAL_TEST=keep\n"
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
    ).rejects.toThrow("sandbox-db create test")

    expect(await readFile(join(fixture.repo, ".env.local"), "utf8")).toBe(localContent)
    expect(await readFile(join(fixture.repo, ".env.test"), "utf8")).toBe(testContent)
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
