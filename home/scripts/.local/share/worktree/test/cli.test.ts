import { afterEach, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// All external lifecycle commands are fake executables. PATH has no fallback to
// real Git/Herdr/provision-env; only the explicit shell's builtin echo runs.
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "worktree-cli-test-"))
  roots.push(root)
  const destination = join(root, "destination")
  mkdirSync(destination)
  const log = join(root, "calls.jsonl")
  const script = `#!${process.execPath}
import { appendFileSync } from "node:fs"
import { basename } from "node:path"
const command = basename(process.argv[1])
const args = process.argv.slice(2)
appendFileSync(process.env.WORKTREE_TEST_LOG, JSON.stringify({ command, args }) + "\\n")
const emit = (result) => console.log(JSON.stringify({ result }))
if (command === "git") {
  if (args.includes("--show-toplevel")) console.log("/repo")
  else if (args.includes("--git-common-dir")) console.log("/repo/.git")
  else if (args.at(-1)?.startsWith("refs/heads/")) process.exit(1)
  else if (args.includes("--verify")) console.log("abc123")
} else if (command === "provision-env") {
  console.log("provision stdout")
  console.error("provision stderr")
  if (process.env.WORKTREE_TEST_FAIL === "provision") process.exit(2)
} else if (command === "herdr") {
  const kind = process.env.WORKTREE_TEST_KIND
  const agent = {
    pane_id: "wA:p1", workspace_id: "wA", name: "wt-feat-feature-wa",
    agent: kind, interactive_ready: true, launch_pending: false
  }
  if (args[0] === "worktree") emit({ type: "worktree_created", workspace: { workspace_id: "wA" }, worktree: { path: process.env.WORKTREE_TEST_DESTINATION, branch: "feat/feature" } })
  else if (args[0] === "pane") emit({ type: "pane_list", panes: [{ pane_id: "wA:p1", workspace_id: "wA", tab_id: "wA:t1" }] })
  else if (args[1] === "start") emit({ type: "agent_started", agent })
  else if (args[1] === "get") emit({ type: "agent_info", agent })
  else if (args[1] === "focus" && process.env.WORKTREE_TEST_FAIL === "focus") { console.error("focus failed"); process.exit(1) }
  else emit({})
} else process.exit(99)
`
  for (const command of ["git", "herdr", "provision-env"]) {
    const path = join(root, command)
    writeFileSync(path, script)
    chmodSync(path, 0o755)
  }
  return { root, destination, log }
}

const run = async (args: string[], kind = "pi", failure = "") => {
  const files = fixture()
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "create", "--branch", "feat/feature", ...args], {
    env: {
      ...process.env, PATH: files.root, SHELL: "/bin/sh", NO_COLOR: "1",
      WORKTREE_TEST_LOG: files.log, WORKTREE_TEST_DESTINATION: files.destination,
      WORKTREE_TEST_KIND: kind, WORKTREE_TEST_FAIL: failure
    },
    stdout: "pipe", stderr: "pipe"
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
  ])
  let calls: Array<{ command: string; args: string[] }> = []
  try { calls = readFileSync(files.log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) } catch {}
  return { stdout, stderr, exitCode, calls, ...files }
}

for (const agent of ["pi", "opencode"] as const) {
  test(`CLI ${agent} --json stdout is only the result, including noisy provisioning/setup and focus warnings`, async () => {
    const result = await run([
      "--agent", agent, "--json", "--prompt", "Implement the feature", "--setup", "echo setup-stdout; echo setup-stderr >&2"
    ], agent, "focus")
    expect(result.exitCode).toBe(0)
    const created = JSON.parse(result.stdout)
    expect(created).toEqual({
      source: "/repo", branch: "feat/feature", base: "abc123", path: result.destination,
      workspaceId: "wA", paneId: "wA:p1", agentName: "wt-feat-feature-wa", agentKind: agent,
      warnings: [expect.stringContaining("destination workspace was not focused")]
    })
    expect(result.stdout.trim().split("\n")).toHaveLength(1)
    for (const progress of ["fetching origin", "provision stdout", "provision stderr", "setup-stdout", "setup-stderr", "worktree: warning:"]) {
      expect(result.stderr).toContain(progress)
    }
    expect(result.calls.filter((call) => call.command === "herdr" && call.args[1] === "prompt")).toHaveLength(1)
    expect(result.calls.find((call) => call.command === "provision-env")?.args).toEqual([
      "--repo", result.destination, "--source", "/repo", "--database", "--non-interactive", "--label", "feat/feature", "--ttl", "7d"
    ])
  })
}

test("CLI default remains Pi with its exact human summary and launch argv", async () => {
  const result = await run([])
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain(`\nworktree: ready\n  branch:     feat/feature\n  base:       abc123\n  path:       ${result.destination}\n  workspace:  wA\n  pi agent:   wt-feat-feature-wa\n`)
  expect(result.stdout).toContain("provision stdout")
  expect(result.calls.find((call) => call.command === "herdr" && call.args[1] === "start")?.args).toEqual([
    "agent", "start", "wt-feat-feature-wa", "--kind", "pi", "--pane", "wA:p1", "--timeout", "120000", "--", "--name", "feat/feature"
  ])
})

for (const agent of ["claude", "Pi", "", "opencode --name bad"]) {
  test(`CLI rejects unsupported agent ${JSON.stringify(agent)} before any external command`, async () => {
    const result = await run(["--agent", agent, "--json"])
    expect(result.exitCode).not.toBe(0)
    expect(result.calls).toEqual([])
    expect(result.stdout).toBe("")
  })
}

test("CLI --json failure emits no success object or child stdout and preserves the checkout", async () => {
  const result = await run(["--agent", "opencode", "--json"], "opencode", "provision")
  expect(result.exitCode).toBe(2)
  expect(result.stdout).toBe("")
  expect(result.stderr).toContain(`preserved worktree ${result.destination} and Herdr workspace wA`)
  expect(result.stderr).toContain("provision stdout")
  expect(result.calls.some((call) => call.command === "herdr" && call.args[0] === "agent")).toBe(false)
})
