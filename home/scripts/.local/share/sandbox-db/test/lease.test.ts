import { expect, test } from "bun:test"
import { NodeContext } from "@effect/platform-node"
import { Effect, Option } from "effect"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Lease } from "../src/domain"
import { allLeases, readLease, removeLease, writeLease } from "../src/lease"

const run = <A>(effect: Effect.Effect<A, unknown, never>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)))

const makeLease = (worktree: string, leaseName: string, envFile: string): Lease => ({
  version: 2,
  leaseName,
  projectId: "project-id",
  parentBranch: "parent-id",
  branchId: `branch-${leaseName}`,
  branchName: `agent/repo-${leaseName}`,
  worktree,
  repository: "owner/repo",
  label: leaseName,
  configEnvFile: `${worktree}/.env.local`,
  envFile,
  envKeys: ["DATABASE_URL", "DATABASE_URL_UNPOOLED"],
  createdAt: "2026-08-13T20:00:00Z",
  expiresAt: "2026-08-20T20:00:00Z"
})

test.serial("named leases coexist and legacy records normalize to default", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "sandbox-db-leases-"))
  const previousStateHome = process.env.XDG_STATE_HOME
  process.env.XDG_STATE_HOME = stateHome

  try {
    const worktree = "/worktrees/repo/feature"
    const development = makeLease(worktree, "default", `${worktree}/.env.local`)
    const testLease = makeLease(worktree, "test", `${worktree}/.env.test`)

    await run(writeLease(development))
    await run(writeLease(testLease))

    const readDevelopment = await run(readLease(worktree, "default"))
    const readTest = await run(readLease(worktree, "test"))
    expect(Option.getOrThrow(readDevelopment).branchId).toBe("branch-default")
    expect(Option.getOrThrow(readTest).branchId).toBe("branch-test")

    const leases = await run(allLeases)
    expect(leases.map((lease) => lease.leaseName)).toEqual(["default", "test"])

    const directory = join(stateHome, "pi", "sandbox-db", "leases")
    const files = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: directory }))
    expect(files).toHaveLength(2)
    for (const file of files) {
      expect((await stat(join(directory, file))).mode & 0o777).toBe(0o600)
    }

    await run(removeLease(worktree, "test"))
    expect(Option.isNone(await run(readLease(worktree, "test")))).toBe(true)
    expect(Option.isSome(await run(readLease(worktree, "default")))).toBe(true)

    await run(removeLease(worktree, "default"))
    const legacyDigest = createHash("sha256").update(worktree).digest("hex").slice(0, 16)
    const legacyFile = join(directory, `${legacyDigest}.json`)
    const legacy = {
      version: 1,
      projectId: "legacy-project",
      parentBranch: "legacy-parent",
      branchId: "legacy-branch",
      branchName: "agent/legacy",
      worktree,
      repository: "owner/repo",
      label: "legacy",
      envFile: `${worktree}/.env.local`,
      envKeys: ["DATABASE_URL"],
      createdAt: "2026-08-13T20:00:00Z",
      expiresAt: "2026-08-20T20:00:00Z"
    }
    await mkdir(directory, { recursive: true })
    await writeFile(legacyFile, `${JSON.stringify(legacy)}\n`)
    await chmod(legacyFile, 0o600)

    const normalized = Option.getOrThrow(await run(readLease(worktree)))
    expect(normalized.version).toBe(2)
    expect(normalized.leaseName).toBe("default")
    expect(normalized.configEnvFile).toBe(legacy.envFile)
    expect(JSON.parse(await readFile(legacyFile, "utf8")).version).toBe(1)
  } finally {
    if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previousStateHome
    await rm(stateHome, { recursive: true, force: true })
  }
})
