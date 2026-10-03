import { afterEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { WorktreeManager, parseWorktreePorcelain, type ManagerRunner } from "../src/manager"

// Herdr-free retirement of `worktree checkout` checkouts: real Git, fake sandbox-db.
const directories: string[] = []
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })

const git = async (args: ReadonlyArray<string>) => {
  const child = Bun.spawn(["git", "-c", "user.name=Test", "-c", "user.email=test@local.invalid", "-c", "commit.gpgSign=false", ...args], { stdout: "pipe", stderr: "ignore" })
  return { code: await child.exited, stdout: await new Response(child.stdout).text() }
}

async function fixture(leaseState: ReadonlyArray<readonly [string, "live" | "missing"]> = [["test", "live"], ["default", "live"]]) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "checkout-manager-"))); directories.push(dir)
  const source = join(dir, "repo"), target = join(dir, "repo-feat-x"), receipts = join(dir, "receipts")
  await mkdir(source)
  await git(["-C", source, "init", "-b", "main"])
  await writeFile(join(source, ".gitignore"), ".env*.local\nnode_modules\n")
  await git(["-C", source, "add", "-A"])
  await git(["-C", source, "commit", "-m", "init"])
  await git(["-C", source, "worktree", "add", "-b", "feat/x", target])
  const calls: string[][] = []
  const leases = new Map<string, "live" | "missing">(leaseState)
  const runner: ManagerRunner = async (command, args) => {
    calls.push([command, ...args])
    if (command === "git") return git(args)
    if (command !== "sandbox-db") return { code: 127, stdout: "" }
    const name = args[args.indexOf("--lease") + 1] ?? ""
    const status = leases.get(name) ?? "none"
    if (args[0] === "list") return { code: 0, stdout: JSON.stringify([...leases.keys()].map((leaseName) => ({ worktree: target, leaseName, branchId: `id-${leaseName}`, connection_url: "https://SECRET.invalid" }))) }
    if (args[0] === "status") return {
      code: status === "live" ? 0 : 1,
      stdout: JSON.stringify({ status, lease: name, worktree: target, ...(status === "none" ? {} : { branch_id: `id-${name}`, releasable: true }) })
    }
    if (args[0] === "release") {
      leases.delete(name)
      return { code: 0, stdout: JSON.stringify({ status: status === "missing" ? "already-gone" : "released", lease: name, branch_id: `id-${name}` }) }
    }
    return { code: 2, stdout: "" }
  }
  const manager = new WorktreeManager(runner, receipts)
  return { dir, source, target, receipts, calls, leases, runner, manager }
}
const mutations = (calls: string[][]) => calls.filter((c) => c.includes("release") || c.includes("remove") || (c.includes("branch") && c.includes("-d")))

test("porcelain parser reads branches and flags; rejects malformed output", () => {
  const parsed = parseWorktreePorcelain("worktree /r\0HEAD a\0branch refs/heads/main\0\0worktree /r-x\0HEAD b\0detached\0locked reason\0\0")
  expect(parsed).toEqual([
    { path: "/r", branch: "main", detached: false, bare: false, locked: false, prunable: false },
    { path: "/r-x", branch: null, detached: true, bare: false, locked: true, prunable: false }
  ])
  expect(() => parseWorktreePorcelain("HEAD a\0\0")).toThrow("Invalid authoritative response")
  expect(() => parseWorktreePorcelain("worktree /r\0HEAD a")).toThrow("Invalid authoritative response")
})

test("plan + retire releases leases, removes via git without force, keeps the branch, never calls Herdr", async () => {
  const f = await fixture([["test", "missing"], ["default", "live"]])
  await writeFile(join(f.target, ".env.local"), "IGNORED=1\n") // ignored provisioning files are not dirt
  const plan = await f.manager.planCheckout(f.source, f.target)
  expect(plan.path).toBe(f.target)
  expect(plan.releases).toEqual(["test", "default"])
  const result = await f.manager.retireCheckout(f.source, f.target, f.target, plan.token)
  expect(result).toMatchObject({ status: "retired", path: f.target, released: ["test", "default"], branch: "kept" })
  expect(existsSync(f.target)).toBe(false)
  expect((await git(["-C", f.source, "branch", "--list", "feat/x"])).stdout).toContain("feat/x")
  const changes = mutations(f.calls)
  expect(changes.at(-1)).toEqual(["git", "-C", f.source, "worktree", "remove", f.target])
  expect(f.calls.flat()).not.toContain("--force")
  expect(f.calls.some((c) => c[0] === "herdr")).toBe(false)
  const receipt = await readFile(result.receipt, "utf8")
  expect(receipt).toContain('"removed-worktree"'); expect(receipt).toContain('"workspace":null')
  expect(receipt).not.toContain("SECRET")
})

test("checkouts without any lease (no-Vercel repos) retire without releases", async () => {
  const f = await fixture([])
  const plan = await f.manager.planCheckout(f.source, f.target)
  expect(plan.releases).toEqual([])
  await f.manager.retireCheckout(f.source, f.target, f.target, plan.token)
  expect(f.calls.some((c) => c.includes("release"))).toBe(false)
  expect(existsSync(f.target)).toBe(false)
})

test("dirty, primary, current, locked and non-canonical targets are refused before any mutation", async () => {
  const f = await fixture()
  await writeFile(join(f.target, "untracked"), "dirty")
  await expect(f.manager.planCheckout(f.source, f.target)).rejects.toThrow("dirty")
  await rm(join(f.target, "untracked"))
  await expect(f.manager.planCheckout(f.source, f.source)).rejects.toThrow("primary")
  await expect(f.manager.planCheckout(f.target, f.target)).rejects.toThrow("current")
  const alias = join(f.dir, "alias"); await symlink(f.target, alias)
  await expect(f.manager.planCheckout(f.source, alias)).rejects.toThrow("canonical")
  await expect(f.manager.planCheckout(f.source, `${f.target}/`)).rejects.toThrow("canonical")
  await git(["-C", f.source, "worktree", "lock", f.target])
  await expect(f.manager.planCheckout(f.source, f.target)).rejects.toThrow("Not a linked checkout")
  expect(mutations(f.calls)).toHaveLength(0)
})

test("token is required and pins HEAD; a moved checkout is preserved", async () => {
  const f = await fixture()
  await expect(f.manager.retireCheckout(f.source, f.target, f.target, "")).rejects.toThrow("expect-plan")
  const plan = await f.manager.planCheckout(f.source, f.target)
  await expect(f.manager.retireCheckout(f.source, f.target, "yes", plan.token)).rejects.toThrow("confirmation")
  await git(["-C", f.target, "commit", "--allow-empty", "-m", "moved"])
  await expect(f.manager.retireCheckout(f.source, f.target, f.target, plan.token)).rejects.toThrow("identity plan changed")
  expect(mutations(f.calls)).toHaveLength(0)
  expect(existsSync(f.target)).toBe(true)
})

test("a checkout plan token cannot drive the Herdr retirement path", async () => {
  const f = await fixture()
  const plan = await f.manager.planCheckout(f.source, f.target)
  // The Herdr path still requires Herdr inventory (unavailable here) and hashes a
  // different identity domain, so the token is useless there.
  await expect(f.manager.retire(f.source, { path: f.target, workspace: "w" }, f.target, false, undefined, undefined, plan.token)).rejects.toThrow("Command failed")
  expect(f.calls.find((c) => c[0] === "herdr")).toEqual(["herdr", "worktree", "list", "--cwd", f.source])
  expect(mutations(f.calls)).toHaveLength(0)
})

test("--delete-branch uses only safe git branch -d; unmerged branches are retained", async () => {
  const merged = await fixture()
  let plan = await merged.manager.planCheckout(merged.source, merged.target)
  expect((await merged.manager.retireCheckout(merged.source, merged.target, merged.target, plan.token, true)).branch).toBe("deleted")
  const unmerged = await fixture()
  await git(["-C", unmerged.target, "commit", "--allow-empty", "-m", "work"])
  plan = await unmerged.manager.planCheckout(unmerged.source, unmerged.target)
  expect((await unmerged.manager.retireCheckout(unmerged.source, unmerged.target, unmerged.target, plan.token, true)).branch).toContain("retained")
  expect(unmerged.calls.find((c) => c.includes("-d"))).toEqual(["git", "-C", unmerged.source, "branch", "-d", "--", "feat/x"])
  expect(unmerged.calls.flat()).not.toContain("-D")
})

test("git worktree remove failure is recorded and blocks a blind retry", async () => {
  const f = await fixture()
  const plan = await f.manager.planCheckout(f.source, f.target)
  const failing: ManagerRunner = async (command, args, signal) =>
    command === "git" && args.includes("remove") ? { code: 128, stdout: "" } : f.runner(command, args, signal)
  await expect(new WorktreeManager(failing, f.receipts).retireCheckout(f.source, f.target, f.target, plan.token)).rejects.toThrow("Command failed")
  expect(existsSync(f.target)).toBe(true)
  const [name] = await readdir(f.receipts)
  expect(await readFile(join(f.receipts, name ?? ""), "utf8")).toContain('"pending-remove"')
  await expect(f.manager.retireCheckout(f.source, f.target, f.target, (await f.manager.planCheckout(f.source, f.target)).token)).rejects.toThrow("Existing receipt")
})

test("worktree-manage CLI: Herdr-free commands need no HERDR_ENV and refuse Herdr-only options", async () => {
  const f = await fixture([])
  const bin = join(f.dir, "bin"); await mkdir(bin)
  await writeFile(join(bin, "sandbox-db"), `#!/bin/sh\ncase "$1" in list) echo '[]';; status) printf '{"status":"none","lease":"%s","worktree":"%s"}' "$6" "$3"; exit 1;; *) exit 2;; esac\n`)
  await chmod(join(bin, "sandbox-db"), 0o755)
  const home = join(f.dir, "home"); await mkdir(home)
  const cli = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/manage-main.ts"), ...args], {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: home }, stdout: "pipe", stderr: "pipe"
    })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { stdout, stderr, code }
  }
  const refused = await cli("plan-checkout", "--cwd", f.source, "--path", f.target, "--workspace", "w")
  expect(refused.code).toBe(2); expect(refused.stderr).toContain("no --workspace")
  const noToken = await cli("retire-checkout", "--cwd", f.source, "--path", f.target, "--confirm", f.target)
  expect(noToken.code).toBe(2); expect(noToken.stderr).toContain("plan-checkout first")
  const plan = await cli("plan-checkout", "--cwd", f.source, "--path", f.target)
  expect(plan.code).toBe(0)
  const { token } = JSON.parse(plan.stdout)
  const retired = await cli("retire-checkout", "--cwd", f.source, "--path", f.target, "--confirm", f.target, "--expect-plan", token)
  expect(retired.code).toBe(0)
  expect(JSON.parse(retired.stdout)).toMatchObject({ status: "retired", path: f.target, released: [], branch: "kept" })
  expect(existsSync(f.target)).toBe(false)
  expect((await readdir(join(home, ".local", "state", "worktree-manager")))[0]).toContain(".complete.jsonl")
})
