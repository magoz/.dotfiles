import { describe, expect, it, vi } from "vitest";
import { runWorktreeManager, type WorktreeManagerDependencies } from "./manager-command.ts";
import type { WorktreeManagerInventory } from "./manager-domain.ts";

const target = {
  path: "/repos/repo-topic",
  label: "topic",
  branch: "feat/topic",
  isDetached: false,
  isLinkedWorktree: true,
  isPrunable: false,
  isCurrent: false,
  git: { status: "clean" as const, changedFileCount: 0 },
  workspace: { id: "w-topic", label: "topic", focused: false, paneCount: 1, tabCount: 1 },
  agent: { paneId: "p-topic", name: "topic-pi", status: "idle" as const, focused: false },
  agents: [{ paneId: "p-topic", name: "topic-pi", status: "idle" as const, focused: false }],
  environment: { status: "ready" as const, development: "ready" as const, test: "ready" as const, vercelLinked: true },
  databases: { status: "ready" as const, leases: [], minimumRemainingMs: 86400000 },
};

const inventory: WorktreeManagerInventory = {
  repository: { name: "repo", root: "/repos/repo", sourceCheckout: "/repos/repo" },
  worktrees: [target],
};

function dependencies(actions: Array<any>): WorktreeManagerDependencies {
  return {
    inventory: { list: vi.fn().mockResolvedValue(inventory) },
    actions: {
      focus: vi.fn(),
      open: vi.fn(),
      focusOrStartPi: vi.fn(),
      listPanes: vi.fn(),
      prompt: vi.fn(),
      provision: vi.fn(),
      fetch: vi.fn(),
      renewDatabases: vi.fn().mockResolvedValue([
        { name: "default", expiresAt: "2026-08-21T00:00:00Z" },
        { name: "test", expiresAt: "2026-08-21T00:00:00Z" },
      ]),
      retire: vi.fn(),
    } as never,
    showOverlay: vi.fn().mockImplementation(async () => actions.shift() ?? { type: "close" }),
    requestCreate: vi.fn(),
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    mode: "tui",
    cwd: "/repos/repo",
    ui: {
      notify: vi.fn(),
      input: vi.fn(),
      select: vi.fn(),
      confirm: vi.fn(),
      setStatus: vi.fn(),
      setEditorText: vi.fn(),
      theme: { fg: (_color: string, text: string) => text },
    },
    ...overrides,
  } as never;
}

describe("runWorktreeManager", () => {
  it("requires interactive TUI mode", async () => {
    const deps = dependencies([]);
    const ctx = context({ mode: "rpc" }) as any;

    await runWorktreeManager(ctx, deps);

    expect(ctx.ui.notify).toHaveBeenCalledWith("/worktrees requires Pi's interactive TUI mode", "error");
    expect(deps.inventory.list).not.toHaveBeenCalled();
  });

  it("renews both leases and refreshes the selected worktree", async () => {
    const deps = dependencies([
      { type: "renew", worktreePath: target.path },
      { type: "close" },
    ]);
    const ctx = context() as any;
    ctx.ui.input.mockResolvedValue("7d");
    ctx.ui.confirm.mockResolvedValue(true);

    await runWorktreeManager(ctx, deps);

    expect(deps.actions.renewDatabases).toHaveBeenCalledWith(target, "7d");
    expect(deps.inventory.list).toHaveBeenCalledTimes(2);
    expect(deps.showOverlay).toHaveBeenNthCalledWith(2, ctx, inventory, target.path);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Renewed default, test"), "info");
  });

  it("opens and then focuses a closed worktree when Enter is used", async () => {
    const closed = { ...target, workspace: undefined, agent: undefined, agents: [] };
    const opened = { ...target };
    const deps = dependencies([
      { type: "focus", worktreePath: target.path },
      { type: "close" },
    ]);
    (deps.inventory.list as any)
      .mockResolvedValueOnce({ ...inventory, worktrees: [closed] })
      .mockResolvedValueOnce({ ...inventory, worktrees: [opened] })
      .mockResolvedValue(inventory);
    const ctx = context() as any;

    await runWorktreeManager(ctx, deps);

    expect(deps.actions.open).toHaveBeenCalledWith(expect.anything(), closed);
    expect(deps.actions.focus).toHaveBeenCalledWith(opened);
  });

  it("asks which Pi to prompt when multiple agents share the workspace", async () => {
    const multiAgent = {
      ...target,
      agents: [
        target.agent,
        { paneId: "p-review", name: "review-pi", status: "idle" as const, focused: false },
      ],
    };
    const deps = dependencies([
      { type: "prompt", worktreePath: target.path },
      { type: "close" },
    ]);
    (deps.inventory.list as any).mockResolvedValue({ ...inventory, worktrees: [multiAgent] });
    const ctx = context() as any;
    ctx.ui.input.mockResolvedValue("Review this");
    ctx.ui.select.mockResolvedValue("review-pi — idle (p-review)");

    await runWorktreeManager(ctx, deps);

    expect(deps.actions.prompt).toHaveBeenCalledWith(multiAgent, "Review this", "p-review");
  });

  it("cancels renewal when the TTL input is dismissed", async () => {
    const deps = dependencies([
      { type: "renew", worktreePath: target.path },
      { type: "close" },
    ]);
    const ctx = context() as any;
    ctx.ui.input.mockResolvedValue(undefined);

    await runWorktreeManager(ctx, deps);

    expect(deps.actions.renewDatabases).not.toHaveBeenCalled();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("routes add through the existing create-worktree handoff and closes the manager", async () => {
    const deps = dependencies([{ type: "create" }]);
    const ctx = context() as any;
    ctx.ui.input.mockResolvedValue("Fix the topic workflow");

    await runWorktreeManager(ctx, deps);

    expect(deps.requestCreate).toHaveBeenCalledWith("Fix the topic workflow");
    expect(deps.showOverlay).toHaveBeenCalledTimes(1);
  });

  it("documents sandbox database deletion before retirement", async () => {
    const provisioned = {
      ...target,
      databases: {
        status: "ready" as const,
        minimumRemainingMs: 86400000,
        leases: [
          { name: "default", branchName: "agent/topic-dev", expiresAt: "2026-08-21T00:00:00Z", remainingMs: 86400000 },
          { name: "test", branchName: "agent/topic-test", expiresAt: "2026-08-21T00:00:00Z", remainingMs: 86400000 },
        ],
      },
    };
    const deps = dependencies([
      { type: "retire", worktreePath: target.path },
      { type: "close" },
    ]);
    (deps.inventory.list as any).mockResolvedValue({ ...inventory, worktrees: [provisioned] });
    (deps.actions.retire as any).mockResolvedValue({
      removedPath: target.path,
      releasedLeases: ["test", "default"],
      branch: "kept",
    });
    const ctx = context() as any;
    ctx.ui.select.mockResolvedValue("Retire worktree only");
    ctx.ui.confirm.mockResolvedValue(true);

    await runWorktreeManager(ctx, deps);

    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Confirm coordinated retirement",
      expect.stringMatching(/Sandbox databases: default, test[\s\S]*deletes any provisioned Neon branches and removes their leased URL keys/),
    );
    expect(deps.actions.retire).toHaveBeenCalledWith(expect.anything(), provisioned, false);
  });

  it("loads the selected path into Pi's editor", async () => {
    const deps = dependencies([{ type: "copy-path", worktreePath: target.path }]);
    const ctx = context() as any;

    await runWorktreeManager(ctx, deps);

    expect(ctx.ui.setEditorText).toHaveBeenCalledWith(target.path);
  });
});
