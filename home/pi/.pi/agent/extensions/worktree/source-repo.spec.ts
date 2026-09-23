import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSourceRepo } from "./source-repo.ts";

let root: string;

const primary = (name: string) => {
  mkdirSync(join(root, name, ".git"), { recursive: true });
  return join(root, name);
};

const linked = (name: string) => {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, ".git"), `gitdir: ${join(root, "repo", ".git", "worktrees", name)}\n`);
  return join(root, name);
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "worktree-source-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveSourceRepo", () => {
  it("uses the session directory while it exists", () => {
    const checkout = linked("repo-feat-live");
    expect(resolveSourceRepo(checkout)).toEqual({ repo: checkout });
  });

  it("recovers the sibling primary checkout after the session's worktree was removed", () => {
    const repo = primary("lmk-10x");
    primary("lmk");
    primary("lmk-10");
    linked("lmk-10x-fix");
    const removed = join(root, "lmk-10x-fix-background-agent-conversation");

    expect(resolveSourceRepo(removed)).toEqual({ repo, recoveredFrom: removed });
  });

  it("recovers from a deleted subdirectory of the removed worktree", () => {
    const repo = primary("app");
    const removed = join(root, "app-feat-reports", "apps", "web");

    expect(resolveSourceRepo(removed)).toEqual({ repo, recoveredFrom: removed });
  });

  it("refuses linked worktrees and unrelated directories as a source", () => {
    linked("app");
    mkdirSync(join(root, "app-feat"));
    primary("other");

    expect(() => resolveSourceRepo(join(root, "app-feat-reports"))).toThrow(
      "Start Pi in the primary checkout",
    );
  });
});
