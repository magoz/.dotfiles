import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { requireNewBranch, resolveBase } from "../src/git"
import { ProcessLive } from "../src/process"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const git = (repo: string, ...args: string[]) => execFileSync("git", [
  "-C", repo, "-c", "user.name=Worktree Test", "-c", "user.email=worktree@example.invalid",
  "-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", ...args
], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "worktree-base-test-"))
  roots.push(root)
  const remote = join(root, "remote.git")
  const source = join(root, "source")
  const producer = join(root, "producer")
  git(root, "init", "--bare", "--initial-branch=main", remote)
  git(root, "clone", remote, producer)
  git(producer, "commit", "--allow-empty", "-m", "old")
  git(producer, "push", "origin", "main")
  git(root, "clone", remote, source)
  const old = git(source, "rev-parse", "HEAD")
  git(producer, "commit", "--allow-empty", "-m", "fresh")
  git(producer, "push", "origin", "main")
  const fresh = git(producer, "rev-parse", "HEAD")
  return { root, remote, source, producer, old, fresh }
}

const resolve = (source: string, base?: string) =>
  Effect.runPromise(resolveBase(source, base).pipe(Effect.provide(ProcessLive)))

const expectCleanRefs = (source: string) =>
  expect(git(source, "for-each-ref", "--format=%(refname)", "refs/worktree-bases/")).toBe("")

test("default base fetches the current remote tip and pins the new checkout to that commit", async () => {
  const { root, source, producer, old, fresh } = fixture()
  expect(git(source, "rev-parse", "origin/main")).toBe(old)
  const base = await resolve(source)
  expect(base).toBe(fresh)
  expect(git(source, "rev-parse", "main")).toBe(old)
  expectCleanRefs(source)

  git(producer, "commit", "--allow-empty", "-m", "later")
  git(producer, "push", "origin", "main")
  git(source, "fetch", "origin")
  const checkout = join(root, "checkout")
  git(source, "worktree", "add", "-b", "feat/fresh", checkout, base)
  expect(git(checkout, "rev-parse", "HEAD")).toBe(fresh)
})

test("default fetch follows a renamed remote default despite stale origin/HEAD and a narrow refspec", async () => {
  const { source, producer, remote, fresh } = fixture()
  git(producer, "push", "origin", "HEAD:refs/heads/trunk")
  git(remote, "symbolic-ref", "HEAD", "refs/heads/trunk")
  git(source, "config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main")
  expect(git(source, "symbolic-ref", "refs/remotes/origin/HEAD")).toBe("refs/remotes/origin/main")
  expect(await resolve(source)).toBe(fresh)
  expectCleanRefs(source)
})

test("concurrent default fetches use independent refs and leave no temporary refs", async () => {
  const { source, fresh } = fixture()
  expect(await Promise.all([resolve(source), resolve(source)])).toEqual([fresh, fresh])
  expectCleanRefs(source)
})

for (const failure of ["missing origin", "unavailable origin", "missing remote HEAD"] as const) {
  test(`default base fails closed with ${failure}, even with usable local history`, async () => {
    const { source, remote, root, old } = fixture()
    if (failure === "missing origin") git(source, "remote", "remove", "origin")
    if (failure === "unavailable origin") git(source, "remote", "set-url", "origin", join(root, "missing.git"))
    if (failure === "missing remote HEAD") git(remote, "symbolic-ref", "HEAD", "refs/heads/missing")
    await expect(resolve(source)).rejects.toThrow("refusing a stale local base")
    expect(git(source, "rev-parse", "HEAD")).toBe(old)
    expectCleanRefs(source)
  })
}

test("explicit branches, tags, commits and historical expressions remain usable offline", async () => {
  const { source, old, root } = fixture()
  git(source, "tag", "historical", old)
  git(source, "branch", "topic", old)
  git(source, "commit", "--allow-empty", "-m", "local")
  git(source, "remote", "set-url", "origin", join(root, "missing.git"))
  for (const base of ["topic", "historical", old, "HEAD~1", "origin/main"]) {
    const resolved = await resolve(source, base)
    expect(resolved).toBe(base)
    expect(git(source, "rev-parse", `${resolved}^{commit}`)).toBe(old)
  }
  expectCleanRefs(source)
})

test("invalid explicit bases fail rather than silently selecting the default", async () => {
  const { source } = fixture()
  for (const base of ["", "missing", "--help", "HEAD^{tree}"]) {
    await expect(resolve(source, base)).rejects.toThrow("base ref does not exist")
  }
  expectCleanRefs(source)
})

test("default creation rejects an existing destination branch without moving it", async () => {
  const { source, old } = fixture()
  await expect(Effect.runPromise(
    requireNewBranch(source, "main").pipe(Effect.provide(ProcessLive))
  )).rejects.toThrow("branch already exists")
  await Effect.runPromise(requireNewBranch(source, "feat/new").pipe(Effect.provide(ProcessLive)))
  expect(git(source, "rev-parse", "main")).toBe(old)
})
