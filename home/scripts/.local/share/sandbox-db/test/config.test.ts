import { expect, test } from "bun:test"
import { NodeContext } from "@effect/platform-node"
import { Effect, Redacted } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadConfig } from "../src/config"

const withEnvFile = async <A>(content: string, use: (file: string) => Promise<A>) => {
  const directory = await mkdtemp(join(tmpdir(), "sandbox-db-config-"))
  const file = join(directory, ".env.local")
  try {
    await writeFile(file, content, { mode: 0o600 })
    return await use(file)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const resolve = (file: string) =>
  Effect.runPromise(loadConfig(file).pipe(Effect.provide(NodeContext.layer)))

test("a complete worktree profile resolves atomically", () =>
  withEnvFile(
    [
      'SANDBOX_DB_NEON_API_KEY="project-key"',
      'SANDBOX_DB_NEON_PROJECT_ID="project-id"',
      'SANDBOX_DB_PARENT_BRANCH_ID="parent-id"'
    ].join("\n"),
    async (file) => {
      const config = await resolve(file)
      expect(config.backend).toBe("worktree-env")
      expect(config.projectId).toBe("project-id")
      expect(config.parentBranch).toBe("parent-id")
      expect(Redacted.value(config.apiKey)).toBe("project-key")
    }
  ))

test("a partial worktree profile does not fall back to global auth", () =>
  withEnvFile("SANDBOX_DB_NEON_API_KEY=project-key\n", async (file) => {
    await expect(resolve(file)).rejects.toThrow("incomplete sandbox database profile")
  }))

test("declared but empty worktree keys do not fall back to global auth", () =>
  withEnvFile(
    [
      "SANDBOX_DB_NEON_API_KEY=",
      "SANDBOX_DB_NEON_PROJECT_ID=",
      "SANDBOX_DB_PARENT_BRANCH_ID="
    ].join("\n"),
    async (file) => {
      await expect(resolve(file)).rejects.toThrow("empty SANDBOX_DB_NEON_API_KEY")
    }
  ))
