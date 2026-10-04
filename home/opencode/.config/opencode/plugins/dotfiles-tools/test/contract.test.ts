import assert from "node:assert/strict"
import test from "node:test"
import { Option } from "effect"
import { decodeLink, decodeOutput, decodeWorktreeInput } from "../contract.ts"
import { resolveInput } from "../worktree.ts"

test("explicit branch wins, else a conventional branch is inferred from the prompt", () => {
  assert.equal(resolveInput({ prompt: "Please create a new worktree to fix the broken café" }).branch, "fix/broken-cafe")
  assert.equal(resolveInput({ branch: "  exact/name  ", prompt: "ignored" }).branch, "exact/name")
  assert.throws(() => resolveInput({}))
})

test("strict boundaries reject a model repo, Herdr-era fields, unknown keys and impossible outputs", () => {
  for (const value of [{ repo: "/evil" }, { setup: ["npm ci"] }, { ttl: "7d" }, { branch: 2 }, { branch: "x\0y" }]) assert.throws(() => decodeWorktreeInput(value))
  const destination = { directory: "/repo-feat-x", branch: "feat/x", sessionID: "ses_new", prompted: true }
  assert.deepEqual(decodeOutput({ status: "ready", destination }), { status: "ready", destination })
  // Each status carries exactly its own data.
  for (const value of [{ status: "ready" }, { status: "failed", reason: "x" }, { status: "vercel_link_required" }, { status: "ready", destination: { ...destination, extra: 1 } }]) {
    assert.throws(() => decodeOutput(value))
  }
  assert.ok(Option.isSome(decodeLink(JSON.stringify({ status: "vercel_link_required", directory: "/repo", reason: "missing" }))))
  assert.ok(Option.isNone(decodeLink("not json")))
  assert.ok(Option.isNone(decodeLink(JSON.stringify({ status: "vercel_link_required", directory: "/repo", reason: "x", token: "secret" }))))
})
