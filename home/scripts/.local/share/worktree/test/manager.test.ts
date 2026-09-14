import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { WorktreeManager, type ManagerRunner } from "../src/manager"

const directories: string[] = []
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "mixed-manager-")); directories.push(dir)
  const source = join(dir, "source"), target = join(dir, "target"), receipts = join(dir, "receipts")
  await mkdir(source)
  const git = async (args: ReadonlyArray<string>) => {
    const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "ignore" })
    return { code: await child.exited, stdout: await new Response(child.stdout).text() }
  }
  await git(["-C", source, "init", "-b", "main"])
  await git(["-C", source, "-c", "user.name=Test", "-c", "user.email=test@local.invalid", "commit", "--allow-empty", "-m", "init"])
  await git(["-C", source, "worktree", "add", "-b", "feature", target])
  const calls: string[][] = []
  const agents = [{ workspace_id: "target-ws", pane_id: "pi-pane", agent: "pi", agent_status: "idle" },
    { workspace_id: "target-ws", pane_id: "oc-pane", agent: "opencode", agent_status: "done" }]
  const leases = new Map([ ["test", "live"], ["default", "live"] ])
  let mutate: (args: ReadonlyArray<string>) => void = () => {}
  let fail = "", malformed = ""
  const runner: ManagerRunner = async (command, args) => {
    calls.push([command, ...args]); mutate(args)
    if ([command, ...args].join(" ").includes(fail) && fail) return { code: 2, stdout: 'secret https://token.invalid' }
    if (command === "git") return git(args)
    let payload: unknown
    let code = 0
    if (command === "herdr") {
      if (args[0] === "worktree" && args[1] === "list") payload = { result: { type: "worktree_list",
        source: { repo_root: source, source_checkout_path: source }, worktrees: [
          { path: source, branch: "main", is_detached: false, is_linked_worktree: false, is_prunable: false, open_workspace_id: "source-ws" },
          { path: target, branch: "feature", is_detached: false, is_linked_worktree: true, is_prunable: false, open_workspace_id: "target-ws" }
        ] } }
      else if (args[0] === "workspace") payload = { result: { type: "workspace_list", workspaces: [{ workspace_id: "source-ws" }, { workspace_id: "target-ws" }] } }
      else if (args[0] === "agent") payload = { result: { type: "agent_list", agents } }
      else payload = { result: { type: "worktree_removed" } }
    } else if (command === "sandbox-db") {
      const name = args[args.indexOf("--lease") + 1] ?? ""
      const status = leases.get(name) ?? "none"
      if (args[0] === "list") payload = [...leases].map(([leaseName]) => ({ worktree: target, leaseName, branchId: `id-${leaseName}`, connection_url: 'https://SECRET.invalid', envFile: 'SECRET' }))
      else if (args[0] === "status") {
        payload = { status, lease: name, worktree: target, ...(status === "none" ? {} : { branch_id: `id-${name}`, releasable: status !== 'protected' }) }
        code = status === "none" || status === "missing" ? 1 : 0
      } else if (args[0] === "release") {
        leases.delete(name); payload = { status: status === "missing" ? "already-gone" : "released", lease: name, branch_id: `id-${name}` }
      } else payload = { status: "renewed", lease: name, expires_at: "2027-01-01T00:00:00Z" }
    }
    return { code, stdout: malformed || JSON.stringify(payload) }
  }
  const manager = new WorktreeManager(runner, receipts)
  const selected = { path: target, workspace: "target-ws" }
  return { dir, source, target, receipts, calls, agents, leases, runner, manager, selected,
    setFail: (v: string) => { fail = v }, setMalformed: (v: string) => { malformed = v },
    setMutation: (fn: typeof mutate) => { mutate = fn } }
}
const mutations = (calls: string[][]) => calls.filter((c) => ["release", "renew", "remove"].includes(c[1] ?? "") || c.includes("remove"))

test("inventory includes Pi AND OpenCode, git state, recorded leases; no env/URLs", async () => {
  const f = await fixture()
  const inventory = await f.manager.list(f.source)
  expect(inventory.worktrees[1]?.agents).toEqual([{ kind: "pi", status: "idle" }, { kind: "opencode", status: "done" }])
  expect(inventory.worktrees[1]?.git).toBe("clean")
  expect(JSON.stringify(inventory)).not.toContain("SECRET")
  expect(f.calls[0]).toEqual(["herdr", "worktree", "list", "--cwd", f.source])
})
for (const kind of ["pi", "opencode"]) for (const status of ["working", "blocked", "unknown"]) {
  test(`retirement rejects ${kind} ${status}`, async () => {
    const f = await fixture(); const agent = f.agents.find((a) => a.agent === kind)
    if (agent) agent.agent_status = status
    await expect(f.manager.retire(f.source, f.selected, f.target)).rejects.toThrow("Agent")
    expect(mutations(f.calls)).toHaveLength(0)
  })
}
test("explicit confirmation, exact workspace, canonical path, primary and subdirectory refused", async () => {
  const f = await fixture()
  await expect(f.manager.retire(f.source, f.selected, "yes")).rejects.toThrow("confirmation")
  await expect(f.manager.plan(f.source, { ...f.selected, workspace: "other" })).rejects.toThrow("identity")
  const alias = join(f.dir, "alias"); await symlink(f.target, alias)
  await expect(f.manager.plan(f.source, { ...f.selected, path: alias })).rejects.toThrow("canonical")
  await expect(f.manager.plan(f.source, { path: f.source, workspace: "source-ws" })).rejects.toThrow("primary")
  // Source cwd must be canonicalized and protected even when launched below target.
  const sub = join(f.target, "sub"); await mkdir(sub)
  const runner: ManagerRunner = async (command, args, signal) => {
    const r = await f.runner(command, args, signal)
    return command === "herdr" && args[0] === "worktree" && args[1] === "list"
      ? { ...r, stdout: r.stdout.replace(`"source_checkout_path":"${f.source}"`, `"source_checkout_path":"${f.target}"`) } : r
  }
  await expect(new WorktreeManager(runner, f.receipts).plan(sub, f.selected)).rejects.toThrow("current")
  expect(mutations(f.calls)).toHaveLength(0)
})
test("dirty/unavailable and unknown harness fail closed", async () => {
  const f = await fixture(); await writeFile(join(f.target, "untracked"), "dirty")
  await expect(f.manager.plan(f.source, f.selected)).rejects.toThrow("dirty")
  await rm(join(f.target, "untracked")); f.setFail(`git -C ${f.target} status`)
  await expect(f.manager.plan(f.source, f.selected)).rejects.toThrow("unavailable")
  f.setFail(""); const a = f.agents[0]; if (a) a.agent = "other"
  await expect(f.manager.plan(f.source, f.selected)).rejects.toThrow("Agent")
})
test("BOTH statuses checked before deletion; live protected second lease preserves all", async () => {
  const f = await fixture();
  const runner: ManagerRunner = async (command, args, signal) => {
    const result = await f.runner(command, args, signal)
    return command === 'sandbox-db' && args[0] === 'status' && args.at(-1) === 'default'
      ? { ...result, stdout: result.stdout.replace('"releasable":true', '"releasable":false') } : result
  }
  await expect(new WorktreeManager(runner, f.receipts).retire(f.source, f.selected, f.target)).rejects.toThrow("releasable")
  expect(f.calls.filter((c) => c[1] === "status").map((c) => c.at(-1))).toEqual(["test", "default"])
  expect(mutations(f.calls)).toHaveLength(0)
})
test("releases missing/live/extra leases before Herdr removal; private durable sanitized receipt", async () => {
  const f = await fixture(); f.leases.set("test", "missing"); f.leases.set("extra", "live")
  const result = await f.manager.retire(f.source, f.selected, f.target)
  expect(result.released).toEqual(["test", "default", "extra"])
  expect(result.branch).toBe("kept")
  const changes = mutations(f.calls)
  expect(changes.at(-1)).toEqual(["herdr", "worktree", "remove", "--workspace", "target-ws"])
  expect(changes).toHaveLength(4)
  const receipt = await readFile(result.receipt, "utf8")
  expect(receipt).toContain('"pending-release"'); expect(receipt).toContain('"complete"')
  expect(receipt).not.toContain("SECRET")
  expect((await stat(result.receipt)).mode & 0o777).toBe(0o600)
})
test("agent becoming active immediately before removal preserves checkout and records partial release", async () => {
  const f = await fixture()
  f.setMutation((args) => { if (args[0] === "agent" && f.leases.size === 0) { const a = f.agents[1]; if (a) a.agent_status = "working" } })
  await expect(f.manager.retire(f.source, f.selected, f.target)).rejects.toThrow("Agent")
  expect(f.calls.some((c) => c.includes("remove"))).toBe(false)
  const name = (await readdir(f.receipts))[0]; if (!name) throw new Error("missing receipt")
  expect(await readFile(join(f.receipts, name), "utf8")).toContain('"released"')
})
test("release failure never removes worktree, receipt prevents blind retry", async () => {
  const f = await fixture(); f.setFail("release --worktree")
  await expect(f.manager.retire(f.source, f.selected, f.target)).rejects.toThrow("Command failed")
  expect(f.calls.some((c) => c.includes("remove"))).toBe(false)
  f.setFail("")
  await expect(f.manager.retire(f.source, f.selected, f.target)).rejects.toThrow("Existing receipt")
})
test("branch -d failure (including squash merge) retains branch, never force deletes", async () => {
  const f = await fixture(); f.setFail("branch -d")
  const result = await f.manager.retire(f.source, f.selected, f.target, true)
  expect(result.branch).toContain("retained")
  expect(f.calls.find((c) => c.includes("-d"))).toEqual(["git", "-C", f.source, "branch", "-d", "--", "feature"])
  expect(f.calls.flat()).not.toContain("--force"); expect(f.calls.flat()).not.toContain("-D")
})
test('optional branch deletion retains a ref that moved after removal', async () => {
  const f = await fixture()
  const runner: ManagerRunner = async (command, args, signal) => {
    const result = await f.runner(command, args, signal)
    if (command === 'herdr' && args.includes('remove')) {
      await f.runner('git', ['-C', f.target, '-c', 'user.name=Test', '-c', 'user.email=test@local.invalid', 'commit', '--allow-empty', '-m', 'moved'])
    }
    return result
  }
  const result = await new WorktreeManager(runner, f.receipts).retire(f.source, f.selected, f.target, true)
  expect(result.branch).toContain('retained')
  expect(f.calls.some((c) => c.includes('-d'))).toBe(false)
})

test("renew preflights both leases and records partial completion", async () => {
  const f = await fixture(); f.leases.set("default", "missing")
  await expect(f.manager.renew(f.source, f.selected, "7d")).rejects.toThrow("live")
  expect(mutations(f.calls)).toHaveLength(0)
  f.leases.set("default", "live")
  const result = await f.manager.renew(f.source, f.selected, "7d")
  expect(result.status).toBe("renewed")
  expect(await readFile(result.receipt, "utf8")).toContain('"complete"')
})
test("malformed responses and command failures never expose command secrets", async () => {
  const f = await fixture(); f.setMalformed('{"secret":"https://SECRET.invalid"}')
  await expect(f.manager.list(f.source)).rejects.toThrow("Invalid authoritative response")
  f.setMalformed(""); f.setFail("herdr")
  await expect(f.manager.list(f.source)).rejects.toThrow("Command failed; preserve resources")
})

test("successful renew archives receipt and permits retirement; changed confirmed plan stops", async () => {
  const f = await fixture()
  const renewal = await f.manager.renew(f.source, f.selected, "7d")
  expect(renewal.receipt).toContain(".complete.jsonl")
  await expect(f.manager.retire(f.source, f.selected, f.target, false, undefined, [])).rejects.toThrow("plan changed")
  const result = await f.manager.retire(f.source, f.selected, f.target, false, undefined, ["default", "test"])
  expect(result.status).toBe("retired")
  expect((await readdir(f.receipts)).length).toBe(2)
})

test('confirmed plan pins database IDs, not merely slot names', async () => {
  const f = await fixture()
  const plan = await f.manager.plan(f.source, f.selected)
  const replacement: ManagerRunner = async (command, args, signal) => {
    const result = await f.runner(command, args, signal)
    return { ...result, stdout: result.stdout.replaceAll('id-default', 'replacement-default') }
  }
  await expect(new WorktreeManager(replacement, f.receipts).retire(f.source, f.selected, f.target, false, undefined, plan.releases, plan.token)).rejects.toThrow('identity plan changed')
  expect(mutations(f.calls)).toHaveLength(0)
})

test('confirmed plan pins Git HEAD and receipts preserve original database IDs', async () => {
  const f = await fixture()
  const plan = await f.manager.plan(f.source, f.selected)
  await f.runner('git', ['-C', f.target, '-c', 'user.name=Test', '-c', 'user.email=test@local.invalid', 'commit', '--allow-empty', '-m', 'moved'])
  await expect(f.manager.retire(f.source, f.selected, f.target, false, undefined, plan.releases, plan.token)).rejects.toThrow('identity plan changed')
  const fresh = await f.manager.plan(f.source, f.selected)
  f.setFail('release --worktree')
  await expect(f.manager.retire(f.source, f.selected, f.target, false, undefined, fresh.releases, fresh.token)).rejects.toThrow('Command failed')
  const file = (await readdir(f.receipts))[0]
  if (!file) throw new Error('missing receipt')
  const receipt = await readFile(join(f.receipts, file), 'utf8')
  expect(receipt).toContain('id-default'); expect(receipt).toContain('id-test'); expect(receipt).toContain('feature')
})
