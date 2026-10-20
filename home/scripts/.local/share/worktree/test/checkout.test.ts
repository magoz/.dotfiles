import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { CheckoutError, checkoutFailureReport } from "../src/domain"
import { MARKER_FILE, readMarker } from "../src/marker"

// Real Git against a local bare "origin"; provision is a fake on PATH that
// records argv. No Herdr, Vercel, Neon or network is reachable.
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const git = (repo: string, ...args: string[]) => execFileSync("git", [
  "-C", repo, "-c", "user.name=Worktree Test", "-c", "user.email=worktree@example.invalid",
  "-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", ...args
], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

const fixture = (files: Record<string, string> = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "worktree-checkout-test-")))
  roots.push(root)
  const origin = join(root, "origin.git")
  const producer = join(root, "producer")
  const repo = join(root, "repo")
  const bin = join(root, "bin")
  git(root, "init", "--bare", "--initial-branch=main", origin)
  git(root, "clone", origin, producer)
  for (const [name, content] of Object.entries({ ".gitignore": ".vercel\n.env*.local\n.env.test\n", ...files })) {
    writeFileSync(join(producer, name), content)
  }
  git(producer, "add", "-A")
  git(producer, "commit", "-m", "old")
  git(producer, "push", "origin", "main")
  git(root, "clone", origin, repo)
  const old = git(repo, "rev-parse", "HEAD")
  git(producer, "commit", "--allow-empty", "-m", "fresh")
  git(producer, "push", "origin", "main")
  const fresh = git(producer, "rev-parse", "HEAD")
  mkdirSync(bin)
  const log = join(root, "provision.jsonl")
  writeFileSync(join(bin, "provision"), `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
echo "provision stdout"
echo "provision stderr" >&2
[ "$FAKE_PROVISION_FAIL" = "1" ] && exit 2
exit 0
`)
  chmodSync(join(bin, "provision"), 0o755)
  return { root, origin, producer, repo, bin, log, old, fresh }
}

type Fixture = ReturnType<typeof fixture>

/** Commit files on origin's default branch only; the source checkout's working tree is untouched. */
const publish = (f: Fixture, files: Record<string, string>) => {
  for (const [name, content] of Object.entries(files)) writeFileSync(join(f.producer, name), content)
  git(f.producer, "add", "-A")
  git(f.producer, "commit", "-m", "publish")
  git(f.producer, "push", "origin", "main")
}

const declaring = (setup: unknown) => JSON.stringify({ name: "app", provision: { setup } })

const run = async (f: Fixture, args: string[], env: Record<string, string> = {}) => {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/main.ts"), "checkout", ...args], {
    cwd: f.root,
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, SHELL: "/bin/sh", NO_COLOR: "1", ...env },
    stdout: "pipe", stderr: "pipe"
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
  ])
  const provisions = existsSync(f.log) ? readFileSync(f.log, "utf8").trim().split("\n") : []
  return { stdout, stderr, exitCode, provisions }
}

const expectNoTempRefs = (repo: string) =>
  expect(git(repo, "for-each-ref", "--format=%(refname)", "refs/worktree-bases/")).toBe("")

const provisioned = (f: Fixture, path: string, label: string, ttl = "7d") =>
  `env --repo ${path} --source ${f.repo} --database --non-interactive --label ${label} --ttl ${ttl}`

test("fresh origin tip, sibling path, owned checkout, provisioned by provision env", async () => {
  const f = fixture()
  const result = await run(f, ["--repo", f.repo, "--branch", "feat/x", "--json"])
  expect(result.exitCode).toBe(0)
  expect(result.stdout.trim().split("\n")).toHaveLength(1)
  const path = join(f.root, "repo-feat-x")
  expect(JSON.parse(result.stdout)).toEqual({ source: f.repo, branch: "feat/x", base: f.fresh, path, warnings: [] })
  expect(git(path, "branch", "--show-current")).toBe("feat/x")
  expect(git(path, "rev-parse", "HEAD")).toBe(f.fresh)
  // Ownership marker in the private git dir, never in the working tree.
  const gitDir = git(path, "rev-parse", "--absolute-git-dir")
  expect(gitDir.startsWith(join(f.repo, ".git", "worktrees") + "/")).toBe(true)
  const marker = JSON.parse(readFileSync(join(gitDir, MARKER_FILE), "utf8"))
  expect(marker).toEqual({ strategy: "dotfiles", branch: "feat/x", createdAt: expect.any(String) })
  expect(Number.isNaN(Date.parse(marker.createdAt))).toBe(false)
  expect(git(path, "status", "--porcelain", "--untracked-files=all")).toBe("")
  // Local main and remote-tracking refs are untouched by the fresh-tip fetch.
  expect(git(f.repo, "rev-parse", "main")).toBe(f.old)
  // Whether this is a Vercel app (env files, databases) or not (install only) is provision's call.
  expect(result.provisions).toEqual([provisioned(f, path, "feat/x")])
  // Child stdout never reaches the JSON channel.
  expect(result.stdout).not.toContain("provision stdout")
  expect(result.stderr).toContain("provision stdout")
  expect(result.stderr).toContain("fetching origin")
  expectNoTempRefs(f.repo)
})

test("--label and --ttl reach provision env", async () => {
  const f = fixture()
  const result = await run(f, ["--repo", f.repo, "--branch", "feat/linked", "--label", "lbl", "--ttl", "3d", "--json"])
  expect(result.exitCode).toBe(0)
  expect(result.provisions).toEqual([provisioned(f, join(f.root, "repo-feat-linked"), "lbl", "3d")])
})

for (const stage of ["provision", "setup"] as const) {
  test(`${stage} failure exits nonzero, reports and preserves the checkout`, async () => {
    const f = fixture({ "bun.lock": "{}\n" })
    const result = await run(
      f,
      ["--repo", f.repo, "--branch", "feat/broken", "--json", "--setup", "exit 7"],
      stage === "provision" ? { FAKE_PROVISION_FAIL: "1" } : {}
    )
    const path = join(f.root, "repo-feat-broken")
    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout)).toEqual({
      status: "failed", stage, branch: "feat/broken", path, checkout: "preserved"
    })
    expect(result.stderr).toContain(`${stage} failed; preserved checkout ${path} on branch feat/broken`)
    expect(git(path, "branch", "--show-current")).toBe("feat/broken")
    // Marked before provisioning, so the preserved checkout stays owned and retirable.
    expect(readMarker(git(path, "rev-parse", "--absolute-git-dir"))?.branch).toBe("feat/broken")
  })
}

test("setup commands run in order in the new checkout through the login shell", async () => {
  const f = fixture()
  const result = await run(f, [
    "--repo", f.repo, "--branch", "feat/setup", "--json",
    "--setup", "pwd > setup.txt; echo setup-stdout", "--setup", "echo second >> setup.txt"
  ])
  expect(result.exitCode).toBe(0)
  const path = join(f.root, "repo-feat-setup")
  expect(readFileSync(join(path, "setup.txt"), "utf8")).toBe(`${path}\nsecond\n`)
  expect(result.stderr).toContain("setup-stdout")
  expect(result.stdout).not.toContain("setup-stdout")
})

test("the declared setup is left to provision env; caller --setup still runs", async () => {
  const f = fixture({ "package.json": declaring(["echo declared >> setup.txt"]) })
  const result = await run(f, ["--repo", f.repo, "--branch", "feat/full", "--json", "--setup", "echo caller >> setup.txt"])
  expect(result.exitCode).toBe(0)
  const path = join(f.root, "repo-feat-full")
  expect(readFileSync(join(path, "setup.txt"), "utf8")).toBe("caller\n")
  expect(result.provisions).toEqual([provisioned(f, path, "feat/full")])
})

const malformed = (setup: unknown) => (f: Fixture) => {
  publish(f, { "package.json": declaring(setup) })
  return ["--branch", "feat/malformed"]
}

const preflightFailures: ReadonlyArray<readonly [string, (f: Fixture) => string[], string]> = [
  ["a non-array provision.setup", malformed("pnpm db:migrate"), "invalid package.json setup"],
  ["a blank provision.setup command", malformed(["pnpm db:migrate", " "]), "setup commands must be non-empty strings"],
  ["an invalid package.json", (f) => { publish(f, { "package.json": "{" }); return ["--branch", "feat/badjson"] }, "invalid package.json setup"],
  ["an existing branch", (f) => { git(f.repo, "branch", "feat/taken"); return ["--branch", "feat/taken"] }, "branch already exists"],
  ["an existing branch with --base", (f) => { git(f.repo, "branch", "feat/taken"); return ["--branch", "feat/taken", "--base", "main"] }, "branch already exists"],
  ["an unreachable origin", (f) => { git(f.repo, "remote", "set-url", "origin", join(f.root, "missing.git")); return ["--branch", "feat/offline"] }, "refusing a stale local base"],
  ["an invalid branch", () => ["--branch", "feat/bad..name"], "invalid branch name"],
  ["a rewritten branch", () => ["--branch", "@{-1}"], "invalid branch name"],
  ["an occupied destination", (f) => { mkdirSync(join(f.root, "repo-feat-occupied")); return ["--branch", "feat/occupied"] }, "destination already exists"],
  ["a missing base", () => ["--branch", "feat/nobase", "--base", "missing"], "base ref does not exist"]
]
for (const [name, setup, message] of preflightFailures) {
  test(`preflight refuses ${name} before allocating anything`, async () => {
    const f = fixture()
    const args = setup(f)
    const branchesBefore = git(f.repo, "branch", "--list")
    const result = await run(f, ["--repo", f.repo, "--json", ...args])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(message)
    expect(JSON.parse(result.stdout)).toEqual({ status: "failed", stage: "preflight", branch: args[1], checkout: "none" })
    expect(git(f.repo, "branch", "--list")).toBe(branchesBefore)
    expect(git(f.repo, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1)
    expect(result.provisions).toEqual([])
    expectNoTempRefs(f.repo)
  })
}

test("explicit --base and --path are used without fetching", async () => {
  const f = fixture()
  git(f.repo, "remote", "set-url", "origin", join(f.root, "missing.git"))
  const result = await run(f, ["--repo", f.repo, "--branch", "feat/explicit", "--base", "main", "--path", "custom", "--json"])
  expect(result.exitCode).toBe(0)
  const created = JSON.parse(result.stdout)
  expect(created.path).toBe(join(f.root, "custom"))
  expect(created.base).toBe("main")
  expect(git(created.path, "rev-parse", "HEAD")).toBe(f.old)
  expect(result.stderr).not.toContain("fetching origin")
})

test("invoked from a linked worktree, the default path is a sibling of the primary checkout", async () => {
  const f = fixture()
  const linked = join(f.root, "elsewhere", "linked")
  git(f.repo, "worktree", "add", "-b", "linked", linked)
  const result = await run(f, ["--repo", linked, "--branch", "feat/from-linked", "--json"])
  expect(result.exitCode).toBe(0)
  const created = JSON.parse(result.stdout)
  expect(created.source).toBe(linked)
  expect(created.path).toBe(join(f.root, "repo-feat-from-linked"))
})

test("human output summarises the checkout; failures without --json print no report", async () => {
  const f = fixture()
  const ok = await run(f, ["--repo", f.repo, "--branch", "feat/human"])
  expect(ok.exitCode).toBe(0)
  expect(ok.stdout).toContain(`worktree: checkout ready\n  branch:     feat/human\n  base:       ${f.fresh}\n  path:       ${join(f.root, "repo-feat-human")}\n`)
  const failed = await run(f, ["--repo", f.repo, "--branch", "feat/human"])
  expect(failed.exitCode).toBe(2)
  expect(failed.stdout).toBe("")
  expect(failed.stderr).toContain("branch already exists")
})

test("failure reports state exactly what may exist, never free text", () => {
  const report = (failure: ConstructorParameters<typeof CheckoutError>[0]["failure"]) =>
    checkoutFailureReport(new CheckoutError({ message: "secret detail", branch: "feat/x", failure }))
  expect(report({ stage: "create", path: "/p" })).toEqual({ status: "failed", stage: "create", branch: "feat/x", path: "/p", checkout: "unknown" })
  expect(JSON.stringify(report({ stage: "setup", path: "/p", base: "abc" }))).not.toContain("secret")
})
