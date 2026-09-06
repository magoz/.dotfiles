import { expect, test } from "bun:test"
import { NodeContext } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
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
  existingTest = false,
  appDir = ".",
  leaseAppDir = appDir
) => {
  const repo = await mkdtemp(join(tmpdir(), "provision-env-"))
  const primary = join(repo, "primary")
  const sibling = join(repo, "sibling")
  await writeFile(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
  // The Git lock stays at checkout scope, independently of the app staging directory.
  await mkdir(join(repo, ".vercel"), { recursive: true })
  const directory = join(repo, appDir)
  for (const root of [repo, primary, sibling]) {
    await mkdir(join(root, appDir, ".vercel"), { recursive: true })
    if (appDir !== ".") {
      await writeFile(join(root, "package.json"), JSON.stringify({ provisionEnv: { appDir } }))
      await writeFile(join(root, appDir, "package.json"), '{"name":"web"}\n')
    }
  }
  if (targetLinked) await writeFile(join(directory, ".vercel", "project.json"), "{}\n")
  const projectIdentity = '{"projectId":"primary","orgId":"team"}\n'
  await writeFile(join(primary, appDir, ".vercel", "project.json"), projectIdentity)
  await writeFile(join(sibling, appDir, ".vercel", "project.json"), projectIdentity)
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
      const existing = (existingDefault && leaseName === "default") ||
        (existingTest && leaseName === "test")
      const sameTarget = args[args.indexOf("--env-file") + 1] ===
        join(leaseAppDir, leaseName === "test" ? ".env.test" : ".env.local")
      const status = existing && sameTarget ? "reused" : "created"
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
            writeFile(join(directory, ".env.local"), "CONCURRENT_CHANGE=keep\n", { mode: 0o600 })
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
  return { repo, directory, primary, sibling, calls, layer, capture, inherit }
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

test("an unlinked explicit source falls back to a linked sibling without Vercel discovery", async () => {
  const fixture = await setup(false, false, false, false)
  await rm(join(fixture.primary, ".vercel/project.json"))
  try {
    await Effect.runPromise(provisionEnvironment({
      ...options(fixture.repo), source: fixture.primary, skipInstall: true, database: false
    }).pipe(Effect.provide(fixture.layer)))
    expect(await readFile(join(fixture.repo, ".vercel/project.json"), "utf8")).toBe(
      '{"projectId":"primary","orgId":"team"}\n'
    )
    expect(fixture.calls.some((call) => call.command === "vercel" && call.args[0] === "api")).toBe(false)
  } finally { await rm(fixture.repo, { recursive: true, force: true }) }
})

test("conflicting sibling identities stop for selection instead of guessing remotely", async () => {
  const fixture = await setup(false, false, false, false)
  await rm(join(fixture.primary, ".vercel/project.json"))
  const other = join(fixture.repo, "other")
  await mkdir(join(other, ".vercel"), { recursive: true })
  await writeFile(join(other, ".vercel/project.json"), '{"projectId":"other","orgId":"team"}')
  const capture: ProvisionProcessService["capture"] = (command, args, runOptions) =>
    command === "git" && args[2] === "worktree"
      ? Effect.succeed({ stdout: `worktree ${fixture.sibling}\n\nworktree ${other}\n`, stderr: "" })
      : fixture.capture(command, args, runOptions)
  const layer = Layer.mergeAll(NodeContext.layer, Layer.succeed(ProvisionProcess, { capture, inherit: fixture.inherit }))
  try {
    await expect(Effect.runPromise(provisionEnvironment({
      ...options(fixture.repo), source: fixture.primary, skipInstall: true
    }).pipe(Effect.provide(layer)))).rejects.toThrow("different Vercel projects")
    expect(fixture.calls.some((call) => call.command === "vercel")).toBe(false)
  } finally { await rm(fixture.repo, { recursive: true, force: true }) }
})

test("Vercel preflight reuses an app-local sibling link without installs, env pulls or database work", async () => {
  const fixture = await setup(false, false, false, false, false, false, false, false, "apps/web")
  try {
    await Effect.runPromise(provisionEnvironment({
      ...options(fixture.repo), checkVercelLink: true
    }).pipe(Effect.provide(fixture.layer)))
    expect(JSON.parse(await readFile(join(fixture.directory, ".vercel/project.json"), "utf8")).projectId).toBe("primary")
    expect(fixture.calls.every((call) => call.command === "git")).toBe(true)
    await expect(readFile(join(fixture.directory, ".env.local"))).rejects.toThrow()
    await expect(stat(join(fixture.repo, ".vercel/provision-env.lock"))).rejects.toThrow()
  } finally { await rm(fixture.repo, { recursive: true, force: true }) }
})

test("Vercel preflight reports the selected app as a typed recovery condition without remote discovery", async () => {
  const fixture = await setup(false, false, false, false, false, false, false, false, "apps/web")
  for (const root of [fixture.primary, fixture.sibling]) await rm(join(root, "apps/web/.vercel/project.json"))
  try {
    const result = await Effect.runPromise(provisionEnvironment({
      ...options(fixture.repo), checkVercelLink: true
    }).pipe(Effect.either, Effect.provide(fixture.layer)))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") expect(result.left).toMatchObject({
      _tag: "VercelLinkRequired", directory: fixture.directory,
      reason: "no Vercel project link found for the selected app"
    })
    expect(fixture.calls.every((call) => call.command === "git")).toBe(true)
    await expect(readFile(join(fixture.directory, ".env.local"))).rejects.toThrow()
  } finally { await rm(fixture.repo, { recursive: true, force: true }) }
})

test("Vercel preflight rejects invalid existing identities rather than offering remote recovery", async () => {
  const fixture = await setup()
  try {
    await expect(Effect.runPromise(provisionEnvironment({
      ...options(fixture.repo), checkVercelLink: true
    }).pipe(Effect.provide(fixture.layer)))).rejects.toThrow("invalid Vercel project identity")
    expect(fixture.calls.every((call) => call.command === "git")).toBe(true)
  } finally { await rm(fixture.repo, { recursive: true, force: true }) }
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

const monorepoSetup = (failTestDatabase = false, targetLinked = true) =>
  setup(failTestDatabase, false, false, targetLinked, false, false, false, false, "apps/web")

const argument = (call: Call, flag: string) => call.args[call.args.indexOf(flag) + 1]

test("monorepo config provisions app envs but installs and owns leases at the checkout root", async () => {
  const fixture = await monorepoSetup()
  const rootEnvironment = "DATABASE_URL=postgres://legacy-root\n"
  try {
    await writeFile(join(fixture.repo, ".env.local"), rootEnvironment)
    await writeFile(join(fixture.repo, ".env.test"), rootEnvironment)
    await Effect.runPromise(provisionEnvironment(options(fixture.repo)).pipe(Effect.provide(fixture.layer)))

    const installs = fixture.calls.filter(call => call.command === "pnpm")
    expect(installs[0]?.args).toEqual(["--dir", fixture.repo, "install", "--frozen-lockfile"])
    for (const call of fixture.calls.filter(call => call.command === "vercel")) {
      expect(argument(call, "--cwd")).toBe(fixture.directory)
    }
    const leases = fixture.calls.filter(call => call.command === "sandbox-db" && call.args[0] === "create")
    expect(leases).toHaveLength(2)
    for (const call of leases) {
      expect(argument(call, "--worktree")).toBe(fixture.repo)
      expect(argument(call, "--config-env-file")).toBe("apps/web/.env.local")
    }
    expect(leases.map(call => argument(call, "--env-file"))).toEqual([
      "apps/web/.env.local", "apps/web/.env.test"
    ])
    for (const [file, lease] of [[".env.local", "default"], [".env.test", "test"]]) {
      const content = await readFile(join(fixture.directory, file!), "utf8")
      expect(content).toContain(`DATABASE_URL=postgres://sandbox-${lease}`)
      expect(content).not.toContain("postgres://vercel")
      expect((await stat(join(fixture.directory, file!))).mode & 0o777).toBe(0o600)
      expect(await readFile(join(fixture.repo, file!), "utf8")).toBe(rootEnvironment)
    }
    await expect(stat(join(fixture.repo, ".vercel", "provision-env.lock"))).rejects.toThrow()
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("monorepo linking uses the same app in siblings, never their root link", async () => {
  const fixture = await monorepoSetup(false, false)
  try {
    await mkdir(join(fixture.primary, ".vercel"), { recursive: true })
    await writeFile(join(fixture.primary, ".vercel", "project.json"), '{"projectId":"wrong-app","orgId":"team"}')
    await Effect.runPromise(provisionEnvironment(options(fixture.repo)).pipe(Effect.provide(fixture.layer)))
    expect(await readFile(join(fixture.directory, ".vercel", "project.json"), "utf8")).toBe(
      '{"projectId":"primary","orgId":"team"}\n'
    )
    await expect(stat(join(fixture.repo, ".vercel", "project.json"))).rejects.toThrow()
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("explicit source linking selects its app-local identity", async () => {
  const fixture = await monorepoSetup(false, false)
  try {
    await Effect.runPromise(provisionEnvironment({
      ...options(fixture.repo), source: fixture.primary
    }).pipe(Effect.provide(fixture.layer)))
    expect(await readFile(join(fixture.directory, ".vercel", "project.json"), "utf8")).toContain('"projectId":"primary"')
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("app-dir flag overrides repository config without changing checkout identity", async () => {
  const fixture = await monorepoSetup()
  try {
    await writeFile(join(fixture.repo, "package.json"), '{"provisionEnv":{"appDir":"missing"}}')
    await Effect.runPromise(provisionEnvironment({
      ...options(fixture.repo), appDir: "apps/web"
    }).pipe(Effect.provide(fixture.layer)))
    expect(await readFile(join(fixture.directory, ".env.local"), "utf8")).toContain("DATABASE_URL=")
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("monorepo rollback restores the app env pair without touching root files", async () => {
  const fixture = await monorepoSetup(true)
  try {
    for (const file of [".env.local", ".env.test"]) {
      await writeFile(join(fixture.repo, file), "ROOT=untouched\n")
      await writeFile(join(fixture.directory, file), "APP=original\n")
    }
    await expect(Effect.runPromise(provisionEnvironment({
      ...options(fixture.repo), envConflict: "overwrite"
    }).pipe(Effect.provide(fixture.layer)))).rejects.toThrow("sandbox-db create test")
    for (const file of [".env.local", ".env.test"]) {
      expect(await readFile(join(fixture.repo, file), "utf8")).toBe("ROOT=untouched\n")
      expect(await readFile(join(fixture.directory, file), "utf8")).toBe("APP=original\n")
    }
    const releases = fixture.calls.filter(call => call.command === "sandbox-db" && call.args[0] === "release")
    expect(releases).toHaveLength(1)
    expect(argument(releases[0]!, "--worktree")).toBe(fixture.repo)
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("monorepo secret checks use checkout-relative app paths before external work", async () => {
  const fixture = await monorepoSetup()
  try {
    const capture: ProvisionProcessService["capture"] = (command, args, options) =>
      command === "git" && args.includes("check-ignore") && args.includes("apps/web/.env.local")
        ? Effect.fail(processFailure("git check-ignore"))
        : fixture.capture(command, args, options)
    const layer = Layer.mergeAll(NodeContext.layer, Layer.succeed(ProvisionProcess, {
      capture, inherit: fixture.inherit
    }))
    await expect(Effect.runPromise(provisionEnvironment(options(fixture.repo)).pipe(
      Effect.provide(layer)
    ))).rejects.toThrow("not git-ignored")
    expect(fixture.calls.some(call => call.command === "vercel" || call.command === "sandbox-db" || call.command === "pnpm")).toBe(false)
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("invalid app directories and symlink traversal fail before external work", async () => {
  const fixture = await monorepoSetup()
  try {
    await symlink(fixture.directory, join(fixture.repo, "web-link"))
    for (const appDir of ["", "/tmp", "../escape", "apps/../web", "apps//web", "apps\\web", "missing", "web-link"]) {
      await expect(Effect.runPromise(provisionEnvironment({
        ...options(fixture.repo), appDir
      }).pipe(Effect.provide(fixture.layer)))).rejects.toThrow()
    }
    expect(fixture.calls.some(call => call.command !== "git")).toBe(false)
    await expect(stat(join(fixture.repo, ".vercel", "provision-env.lock"))).rejects.toThrow()
  } finally {
    await rm(fixture.repo, { recursive: true, force: true })
  }
})

test("app-local secret and Vercel symlinks fail before external work, including dangling links", async () => {
  for (const file of [".env.local", ".env.test", ".vercel", ".vercel/project.json"]) {
    for (const dangling of [false, true]) {
      const fixture = await monorepoSetup()
      try {
        const destination = join(fixture.repo, "link-destination")
        if (!dangling) {
          if (file === ".vercel") await mkdir(destination)
          else await writeFile(destination, "DO_NOT_READ_OR_CHANGE\n")
        }
        const target = join(fixture.directory, file)
        await rm(target, { recursive: true, force: true })
        await symlink(destination, target)
        await expect(Effect.runPromise(provisionEnvironment(options(fixture.repo)).pipe(
          Effect.provide(fixture.layer)
        ))).rejects.toThrow("provisioning path")
        expect(fixture.calls.some(call => call.command !== "git")).toBe(false)
        if (!dangling && file !== ".vercel") {
          expect(await readFile(destination, "utf8")).toBe("DO_NOT_READ_OR_CHANGE\n")
        }
      } finally {
        await rm(fixture.repo, { recursive: true, force: true })
      }
    }
  }
})

test("root-path leases are replaced at app paths; migration rollback only releases the new lease", async () => {
  for (const failTestDatabase of [false, true]) {
    const fixture = await setup(failTestDatabase, true, false, true, false, false, false, true, "apps/web", ".")
    try {
      for (const file of [".env.local", ".env.test"]) {
        await writeFile(join(fixture.repo, file), "DATABASE_URL=postgres://legacy-root\n")
      }
      const run = Effect.runPromise(provisionEnvironment(options(fixture.repo)).pipe(Effect.provide(fixture.layer)))
      if (failTestDatabase) await expect(run).rejects.toThrow("sandbox-db create test")
      else await run
      for (const file of [".env.local", ".env.test"]) {
        expect(await readFile(join(fixture.repo, file), "utf8")).toBe("DATABASE_URL=postgres://legacy-root\n")
        if (failTestDatabase) await expect(stat(join(fixture.directory, file))).rejects.toThrow()
        else expect(await readFile(join(fixture.directory, file), "utf8")).toContain("postgres://sandbox-")
      }
      const leases = fixture.calls.filter(call => call.command === "sandbox-db" && call.args[0] === "create")
      expect(leases).toHaveLength(2)
      expect(leases.every(call => argument(call, "--worktree") === fixture.repo)).toBe(true)
      const releases = fixture.calls.filter(call => call.command === "sandbox-db" && call.args[0] === "release")
      expect(releases).toHaveLength(failTestDatabase ? 1 : 0)
      if (failTestDatabase) expect(argument(releases[0]!, "--lease")).toBe("default")
    } finally {
      await rm(fixture.repo, { recursive: true, force: true })
    }
  }
})

test("malformed repository provisioning config fails rather than silently writing at root", async () => {
  const fixture = await setup()
  try {
    for (const content of ['{"provisionEnv":{"appDir":42}}', '{"provisionEnv":{}}', '{broken']) {
      await writeFile(join(fixture.repo, "package.json"), content)
      await expect(Effect.runPromise(provisionEnvironment(options(fixture.repo)).pipe(
        Effect.provide(fixture.layer)
      ))).rejects.toThrow("invalid package.json")
    }
    expect(fixture.calls.some(call => call.command !== "git")).toBe(false)
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
