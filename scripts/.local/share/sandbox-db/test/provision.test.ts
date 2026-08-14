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

const processFailure = (command: string) =>
  new ProvisionProcessError({ command, exitCode: 1, stdout: "", stderr: "" })

const setup = async (
  failTestDatabase = false,
  existingDefault = false,
  failTestPull = false,
  targetLinked = true
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
  skipVercel: false
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
