import assert from "node:assert/strict"
import test from "node:test"
import { decodeDestination, decodeOutcome, decodeWorktreeInput, type Destination } from "../contract.ts"
import { buildArgs, resolveInput } from "../worktree.ts"

const destination: Destination = {
  source: "/repo", branch: "feat/task", base: "abc123", path: "/worktrees/task",
  workspaceId: "workspace", paneId: "pane", agentName: "task", agentKind: "opencode", warnings: [],
}

test("same inferred branch and optional CLI argv behavior, explicit OpenCode/JSON", () => {
  assert.equal(resolveInput({ prompt: "Please create a new worktree to fix the broken café" }).branch, "fix/broken-cafe")
  assert.equal(resolveInput({ branch: "  exact/name  ", prompt: "ignored" }).branch, "exact/name")
  assert.throws(() => resolveInput({}))
  const input = { branch: "feat/task", base: "origin/main", path: "/checkout space", label: "label", ttl: "7d", prompt: "hello; no shell", setup: ["one", "two"] }
  assert.deepEqual(buildArgs(input, "/repo"), [
    "create", "--agent", "opencode", "--json", "--repo", "/repo", "--branch", "feat/task", "--base", "origin/main", "--path", "/checkout space",
    "--label", "label", "--ttl", "7d", "--prompt", "hello; no shell", "--setup", "one", "--setup", "two",
  ])
  assert.ok(!buildArgs({ prompt: "task" }, "/repo").includes("--base"))
})

test("strict boundaries reject a model repo, unknown fields, non-OpenCode or incomplete success, impossible outcomes", () => {
  for (const value of [{ repo: "/evil" }, { branch: 2 }, { setup: ["ok", null] }, { branch: "x\0y" }]) assert.throws(() => decodeWorktreeInput(value))
  for (const value of [{ ...destination, agentKind: "pi" }, { ...destination, extra: true }, { branch: "x" }]) assert.throws(() => decodeDestination(value))
  // Each status carries exactly its own data.
  for (const value of [{ status: "ready" }, { status: "failed" }, { status: "vercel_link_required" }, { status: "ready", destination, sourceRetained: false }]) {
    assert.throws(() => decodeOutcome(value))
  }
  assert.deepEqual(decodeOutcome({ status: "failed", reason: "x" }), { status: "failed", reason: "x" })
})
