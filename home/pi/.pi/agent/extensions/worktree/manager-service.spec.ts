import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorktreeManagerService, type ManagerCommandRunner } from "./manager-service.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createCheckout(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "worktree-manager-"));
  temporaryDirectories.push(root);
  const checkout = join(root, name);
  await mkdir(join(checkout, ".vercel"), { recursive: true });
  await writeFile(join(checkout, ".vercel", "project.json"), "{}\n");
  for (const file of [".env.local", ".env.test"]) {
    const path = join(checkout, file);
    await writeFile(path, "SECRET=not-read-by-the-manager\n", { mode: 0o600 });
    await chmod(path, 0o600);
  }
  return checkout;
}

function result(stdout: string, code = 0) {
  return { stdout, stderr: "", code, killed: false };
}

describe("WorktreeManagerService inventory", () => {
  it("combines Git, Herdr, Pi, environment, and lease state without exposing secret contents", async () => {
    const primary = await createCheckout("repo");
    const topic = await createCheckout("repo-feat-topic");
    const now = new Date("2026-08-14T12:00:00Z");

    const run = vi.fn<ManagerCommandRunner["run"]>(async (command, args) => {
      if (command === "herdr" && args[0] === "worktree") {
        return result(JSON.stringify({
          result: {
            type: "worktree_list",
            source: {
              repo_key: join(primary, ".git"),
              repo_name: "repo",
              repo_root: primary,
              source_checkout_path: primary,
              source_workspace_id: "w-main",
            },
            worktrees: [
              {
                branch: "main",
                is_bare: false,
                is_detached: false,
                is_linked_worktree: false,
                is_prunable: false,
                label: "repo",
                open_workspace_id: "w-main",
                path: primary,
              },
              {
                branch: "feat/topic",
                is_bare: false,
                is_detached: false,
                is_linked_worktree: true,
                is_prunable: false,
                label: "topic",
                open_workspace_id: "w-topic",
                path: topic,
              },
            ],
          },
        }));
      }
      if (command === "herdr" && args[0] === "workspace") {
        return result(JSON.stringify({
          result: {
            type: "workspace_list",
            workspaces: [
              { workspace_id: "w-main", label: "repo", focused: true, agent_status: "working", pane_count: 2, tab_count: 2 },
              { workspace_id: "w-topic", label: "topic", focused: false, agent_status: "idle", pane_count: 1, tab_count: 1 },
            ],
          },
        }));
      }
      if (command === "herdr" && args[0] === "agent") {
        return result(JSON.stringify({
          result: {
            type: "agent_list",
            agents: [
              { workspace_id: "w-main", pane_id: "p-main", name: "main-pi", agent: "pi", agent_status: "working", focused: true },
              { workspace_id: "w-topic", pane_id: "p-topic-idle", name: "topic-idle", agent: "pi", agent_status: "idle", focused: false },
              { workspace_id: "w-topic", pane_id: "p-topic", name: "topic-pi", agent: "pi", agent_status: "working", focused: true },
            ],
          },
        }));
      }
      if (command === "sandbox-db") {
        return result(JSON.stringify([
          { version: 2, leaseName: "default", worktree: topic, branchName: "agent/topic-dev", expiresAt: "2026-08-17T12:00:00Z" },
          { version: 2, leaseName: "test", worktree: topic, branchName: "agent/topic-test", expiresAt: "2026-08-16T12:00:00Z" },
        ]));
      }
      if (command === "git" && args.includes("status")) {
        return result(args.includes(topic) ? " M src/topic.ts\n?? src/new.ts\n" : "");
      }
      if (command === "git" && args.includes("rev-list")) {
        return result(args.includes(topic) ? "2\t1\n" : "0\t0\n");
      }
      if (command === "git" && args.includes("check-ignore")) return result("");
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    });

    const service = new WorktreeManagerService({ run }, { now: () => now });
    const inventory = await service.list(primary);
    const selected = inventory.worktrees[1]!;

    expect(inventory.repository).toEqual({ name: "repo", root: primary, sourceCheckout: primary });
    expect(selected).toMatchObject({
      path: topic,
      branch: "feat/topic",
      isCurrent: false,
      git: { status: "dirty", changedFileCount: 2, ahead: 2, behind: 1 },
      workspace: { id: "w-topic", label: "topic", focused: false },
      agent: { paneId: "p-topic", name: "topic-pi", status: "working" },
      environment: { status: "ready", development: "ready", test: "ready", vercelLinked: true },
      databases: { status: "ready", minimumRemainingMs: 2 * 24 * 60 * 60 * 1000 },
    });
    expect(selected.agents).toHaveLength(2);
    expect(selected.agents.map((agent) => agent.paneId)).toEqual(["p-topic", "p-topic-idle"]);
    expect(JSON.stringify(inventory)).not.toContain("SECRET=not-read-by-the-manager");
  });
});
