import { describe, expect, it, vi } from "vitest";
import {
  WorktreeActionService,
  type ManagerCommandRunner,
  ManagerActionError,
} from "./manager-actions.ts";
import type { ManagedWorktree, WorktreeManagerInventory } from "./manager-domain.ts";

function result(stdout = "{}", code = 0, stderr = "") {
  return { stdout, stderr, code, killed: false };
}

function managed(overrides: Partial<ManagedWorktree> = {}): ManagedWorktree {
  return {
    path: "/repos/repo-feat-topic",
    label: "topic",
    branch: "feat/topic",
    isDetached: false,
    isLinkedWorktree: true,
    isPrunable: false,
    isCurrent: false,
    git: { status: "clean", changedFileCount: 0, ahead: 0, behind: 0 },
    workspace: { id: "w-topic", label: "topic", focused: false, paneCount: 1, tabCount: 1 },
    agent: { paneId: "p-topic", name: "topic-pi", status: "idle", focused: false },
    agents: [{ paneId: "p-topic", name: "topic-pi", status: "idle", focused: false }],
    environment: { status: "ready", development: "ready", test: "ready", vercelLinked: true },
    databases: {
      status: "ready",
      leases: [
        { name: "default", branchName: "agent/topic-dev", expiresAt: "2026-08-20T00:00:00Z", remainingMs: 1 },
        { name: "test", branchName: "agent/topic-test", expiresAt: "2026-08-20T00:00:00Z", remainingMs: 1 },
      ],
      minimumRemainingMs: 1,
    },
    ...overrides,
  };
}

const inventory: WorktreeManagerInventory = {
  repository: { name: "repo", root: "/repos/repo", sourceCheckout: "/repos/repo" },
  worktrees: [],
};

describe("WorktreeActionService", () => {
  it("focuses existing workspaces and opens unmanaged checkouts through Herdr", async () => {
    const run = vi.fn<ManagerCommandRunner["run"]>().mockResolvedValue(result());
    const actions = new WorktreeActionService({ run });

    await actions.focus(managed());
    await actions.open(inventory, managed({ workspace: undefined, agent: undefined }));

    expect(run).toHaveBeenNthCalledWith(1, "herdr", ["workspace", "focus", "w-topic"], undefined);
    expect(run).toHaveBeenNthCalledWith(
      2,
      "herdr",
      ["worktree", "open", "--cwd", "/repos/repo", "--path", "/repos/repo-feat-topic", "--no-focus"],
      undefined,
    );
  });

  it("focuses an existing Pi or starts and verifies a new Pi before prompting it", async () => {
    const run = vi.fn<ManagerCommandRunner["run"]>(async (command, args) => {
      if (command === "herdr" && args[0] === "pane" && args[1] === "list") {
        return result(JSON.stringify({ result: { type: "pane_list", panes: [{ pane_id: "p-topic", workspace_id: "w-topic", tab_id: "t-topic" }] } }));
      }
      if (command === "herdr" && args[0] === "agent" && args[1] === "get") {
        return result(JSON.stringify({ result: { type: "agent_info", agent: { pane_id: "p-topic", workspace_id: "w-topic", name: "wt-topic-w-topic", interactive_ready: true, launch_pending: false } } }));
      }
      return result();
    });
    const actions = new WorktreeActionService({ run });

    await actions.focusOrStartPi(managed());
    await actions.focusOrStartPi(managed({ agent: undefined }), "Implement the topic");

    expect(run).toHaveBeenCalledWith("herdr", ["agent", "focus", "p-topic"], undefined);
    expect(run).toHaveBeenCalledWith(
      "herdr",
      ["agent", "start", "wt-topic-w-topic", "--kind", "pi", "--pane", "p-topic", "--timeout", "120000", "--", "--name", "topic"],
      undefined,
    );
    expect(run).toHaveBeenCalledWith("herdr", ["agent", "prompt", "p-topic", "Implement the topic"], undefined);
    expect(run).toHaveBeenCalledWith("herdr", ["workspace", "focus", "w-topic"], undefined);
  });

  it("focuses and prompts an explicitly selected Pi when a workspace has multiple agents", async () => {
    const run = vi.fn<ManagerCommandRunner["run"]>().mockResolvedValue(result());
    const actions = new WorktreeActionService({ run });
    const multiAgent = managed({
      agents: [
        { paneId: "p-topic", name: "topic-pi", status: "working", focused: true },
        { paneId: "p-review", name: "review-pi", status: "idle", focused: false },
      ],
    });

    await actions.focusOrStartPi(multiAgent, undefined, undefined, "p-review");
    await actions.prompt(multiAgent, "Review this", "p-review");

    expect(run).toHaveBeenCalledWith("herdr", ["agent", "focus", "p-review"], undefined);
    expect(run).toHaveBeenCalledWith("herdr", ["agent", "prompt", "p-review", "Review this"], undefined);
  });

  it("recovers a Herdr start timeout only when Pi is detected idle in the exact pane", async () => {
    const run = vi.fn<ManagerCommandRunner["run"]>(async (command, args) => {
      if (command === "herdr" && args[0] === "pane") {
        return result(JSON.stringify({ result: { type: "pane_list", panes: [{ pane_id: "p-topic", workspace_id: "w-topic", tab_id: "t-topic" }] } }));
      }
      if (command === "herdr" && args[0] === "agent" && args[1] === "start") {
        return result(JSON.stringify({ error: { code: "cli:agent:start:timeout" } }), 1);
      }
      if (command === "herdr" && args[0] === "agent" && args[1] === "get" && args[2] === "p-topic") {
        return result(JSON.stringify({ result: { type: "agent_info", agent: { pane_id: "p-topic", workspace_id: "w-topic", agent: "pi", agent_status: "idle" } } }));
      }
      return result();
    });
    const actions = new WorktreeActionService({ run });

    await actions.focusOrStartPi(managed({ agent: undefined }), "Continue");

    expect(run).toHaveBeenCalledWith("herdr", ["agent", "get", "p-topic"], undefined);
    expect(run).toHaveBeenCalledWith("herdr", ["agent", "prompt", "p-topic", "Continue"], undefined);
  });

  it("prompts only an existing Pi and provisions only incomplete environments", async () => {
    const run = vi.fn<ManagerCommandRunner["run"]>().mockResolvedValue(result());
    const actions = new WorktreeActionService({ run });
    const incomplete = managed({
      environment: { status: "missing", development: "missing", test: "missing", vercelLinked: false },
      databases: { status: "missing", leases: [] },
    });

    await actions.prompt(managed(), "Continue carefully");
    await actions.provision(inventory, incomplete, "3d");

    expect(run).toHaveBeenCalledWith("herdr", ["agent", "prompt", "p-topic", "Continue carefully"], undefined);
    expect(run).toHaveBeenCalledWith(
      "provision-env",
      ["--repo", incomplete.path, "--source", "/repos/repo", "--database", "--non-interactive", "--label", "topic", "--ttl", "3d"],
      expect.objectContaining({ cwd: incomplete.path }),
    );
    await expect(actions.provision(inventory, managed(), "3d")).rejects.toThrow("already provisioned");
  });

  it("preflights and renews both live database lease slots", async () => {
    const run = vi.fn<ManagerCommandRunner["run"]>(async (_command, args) => {
      if (args[0] === "status") {
        return result(JSON.stringify({ status: "live", lease: args.at(-1) }));
      }
      if (args[0] === "renew") {
        return result(JSON.stringify({ status: "renewed", lease: args[args.indexOf("--lease") + 1], expires_at: "2026-08-21T00:00:00Z" }));
      }
      return result();
    });
    const actions = new WorktreeActionService({ run });

    const renewed = await actions.renewDatabases(managed(), "7d");

    expect(renewed.map((lease) => lease.name)).toEqual(["default", "test"]);
    expect(run.mock.calls.filter(([, args]) => args[0] === "status")).toHaveLength(2);
    expect(run.mock.calls.filter(([, args]) => args[0] === "renew")).toHaveLength(2);
  });

  it("retires only clean non-current worktrees after lease preflight and reports partial failures", async () => {
    const run = vi.fn<ManagerCommandRunner["run"]>(async (command, args) => {
      if (command === "git" && args.includes("status")) return result("");
      if (command === "sandbox-db" && args[0] === "status") {
        return result(JSON.stringify({ status: "live", lease: args.at(-1) }));
      }
      if (command === "sandbox-db" && args[0] === "release") {
        return result(JSON.stringify({ status: "released", lease: args.at(-1) }));
      }
      if (command === "herdr" && args[0] === "worktree" && args[1] === "remove") {
        return result("", 2, "workspace removal failed");
      }
      return result();
    });
    const actions = new WorktreeActionService({ run });

    await expect(actions.retire(inventory, managed(), false)).rejects.toMatchObject({
      completedSteps: ["released database lease test", "released database lease default"],
    });

    await expect(actions.retire(inventory, managed({ isCurrent: true }), false)).rejects.toThrow("current worktree");
    await expect(actions.retire(inventory, managed({ isLinkedWorktree: false }), false)).rejects.toThrow("primary checkout");
    await expect(actions.retire(inventory, managed({
      agents: [
        { paneId: "p-idle", status: "idle", focused: false },
        { paneId: "p-working", status: "working", focused: false },
      ],
    }), false)).rejects.toThrow("Pi is working");
    await expect(actions.retire(inventory, managed({ git: { status: "dirty", changedFileCount: 1 } }), false)).rejects.toThrow("uncommitted changes");
    expect(run).not.toHaveBeenCalledWith("git", expect.arrayContaining(["branch", "-D"]), expect.anything());
  });

  it("queries both lease slots during retirement even when the inventory snapshot has none", async () => {
    const run = vi.fn<ManagerCommandRunner["run"]>(async (command, args) => {
      if (command === "git" && args.includes("status")) return result("");
      if (command === "sandbox-db" && args[0] === "status") {
        return result(JSON.stringify({ status: "live", lease: args.at(-1) }));
      }
      if (command === "sandbox-db" && args[0] === "release") {
        return result(JSON.stringify({ status: "released", lease: args.at(-1) }));
      }
      return result();
    });
    const actions = new WorktreeActionService({ run });
    const stale = managed({ databases: { status: "missing", leases: [] } });

    const outcome = await actions.retire(inventory, stale, false);

    expect(outcome.releasedLeases).toEqual(["test", "default"]);
    expect(run.mock.calls.filter(([command, args]) => command === "sandbox-db" && args[0] === "status")).toHaveLength(2);
  });
});
