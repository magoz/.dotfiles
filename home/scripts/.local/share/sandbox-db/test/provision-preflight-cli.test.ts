import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Exercise the actual cross-process protocol consumed by create_worktree.
test("CLI preflight emits recovery JSON/exit 3, then succeeds after the agent links", async () => {
  const repo = await mkdtemp(join(tmpdir(), "provision-preflight-cli-"))
  try {
    const git = Bun.spawn(["git", "init", repo], { stdout: "ignore", stderr: "pipe" })
    expect(await git.exited).toBe(0)
    await mkdir(join(repo, "apps/web"), { recursive: true })
    await writeFile(join(repo, "package.json"), JSON.stringify({ provisionEnv: { appDir: "apps/web" } }))
    await writeFile(join(repo, "apps/web/package.json"), '{"name":"web"}')
    await writeFile(join(repo, ".gitignore"), ".vercel/\n.env*\n")
    await writeFile(join(repo, "apps/web/.env.local"), "EXISTING=keep\n")
    const run = async () => {
      const child = Bun.spawn([
        process.execPath, join(import.meta.dir, "../src/provision-main.ts"),
        "--repo", repo, "--check-vercel-link", "--non-interactive",
      ], { stdout: "pipe", stderr: "pipe" })
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
      ])
      return { code, stdout, stderr }
    }
    const missing = await run()
    expect(missing.code).toBe(3)
    expect(missing.stdout).toBe("")
    expect(JSON.parse(missing.stderr)).toEqual({
      status: "vercel_link_required", directory: join(repo, "apps/web"),
      reason: "no Vercel project link found for the selected app"
    })
    await mkdir(join(repo, "apps/web/.vercel"))
    await writeFile(join(repo, "apps/web/.vercel/project.json"), '{"projectId":"prj_web","orgId":"team_one"}')
    const linked = await run()
    expect(linked).toEqual({ code: 0, stdout: "", stderr: "" })
    expect(await readFile(join(repo, "apps/web/.env.local"), "utf8")).toBe("EXISTING=keep\n")
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
