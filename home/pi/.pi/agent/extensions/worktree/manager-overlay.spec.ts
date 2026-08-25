import { describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { WorktreeManagerOverlay } from "./manager-overlay.ts";
import type { WorktreeManagerInventory } from "./manager-domain.ts";

const inventory: WorktreeManagerInventory = {
  repository: { name: "repo", root: "/repos/repo", sourceCheckout: "/repos/repo" },
  worktrees: [
    {
      path: "/repos/repo",
      label: "repo",
      branch: "main",
      isDetached: false,
      isLinkedWorktree: false,
      isPrunable: false,
      isCurrent: true,
      git: { status: "clean", changedFileCount: 0, ahead: 0, behind: 0 },
      workspace: { id: "w-main", label: "repo", focused: true, paneCount: 2, tabCount: 2 },
      agent: { paneId: "p-main", name: "main-pi", status: "working", focused: true },
      agents: [{ paneId: "p-main", name: "main-pi", status: "working", focused: true }],
      environment: { status: "ready", development: "ready", test: "ready", vercelLinked: true },
      databases: { status: "missing", leases: [] },
    },
    {
      path: "/repos/repo-feat-topic",
      label: "topic",
      branch: "feat/topic",
      isDetached: false,
      isLinkedWorktree: true,
      isPrunable: false,
      isCurrent: false,
      git: { status: "dirty", changedFileCount: 2, ahead: 2, behind: 1 },
      workspace: { id: "w-topic", label: "topic", focused: false, paneCount: 1, tabCount: 1 },
      agent: { paneId: "p-topic", name: "topic-pi", status: "idle", focused: false },
      agents: [{ paneId: "p-topic", name: "topic-pi", status: "idle", focused: false }],
      environment: { status: "ready", development: "ready", test: "ready", vercelLinked: true },
      databases: {
        status: "ready",
        leases: [
          { name: "default", branchName: "agent/topic-dev", expiresAt: "2026-08-20T00:00:00Z", remainingMs: 3 * 86400000 },
          { name: "test", branchName: "agent/topic-test", expiresAt: "2026-08-19T00:00:00Z", remainingMs: 2 * 86400000 },
        ],
        minimumRemainingMs: 2 * 86400000,
      },
    },
  ],
};

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

describe("WorktreeManagerOverlay", () => {
  it("renders workspace, Pi, environment, database, and selected-worktree details within width", () => {
    const done = vi.fn();
    const overlay = new WorktreeManagerOverlay(
      { terminal: { rows: 30 }, requestRender: vi.fn() } as never,
      theme as never,
      inventory,
      done,
      "/repos/repo-feat-topic",
    );

    const lines = overlay.render(100);
    const text = lines.join("\n");

    expect(text).toContain("Worktrees — repo");
    expect(text).toContain("feat/topic");
    expect(text).toContain("2 changed");
    expect(text).toContain("Pi:");
    expect(text).toContain("idle");
    expect(text).toContain("Environment:");
    expect(text).toContain("ready");
    expect(text).toContain("Databases:");
    expect(text).toContain("2d");
    expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true);
  });

  it("keeps workspace and environment state visible in the supported narrow layout", () => {
    const overlay = new WorktreeManagerOverlay(
      { terminal: { rows: 30 }, requestRender: vi.fn() } as never,
      theme as never,
      inventory,
      vi.fn(),
    );

    const text = overlay.render(80).join("\n");

    expect(text).toContain("focused");
    expect(text).toContain("env:ready");
  });

  it("uses conventional Pi key names and action verbs at the minimum width", () => {
    const overlay = new WorktreeManagerOverlay(
      { terminal: { rows: 30 }, requestRender: vi.fn() } as never,
      theme as never,
      inventory,
      vi.fn(),
    );

    const lines = overlay.render(78);
    const text = lines.join("\n");

    expect(text).toContain("↑↓/jk select · Enter focus");
    expect(text).toContain("a create");
    expect(text).toContain("p start/focus Pi");
    expect(text).toContain("n renew leases");
    expect(text).toContain("c load path");
    expect(text).toContain("q/Esc close");
    expect(lines.every((line) => visibleWidth(line) <= 78)).toBe(true);
  });

  it.each(["\u001b[B", "j"])("moves down with %j", (down) => {
    const done = vi.fn();
    const overlay = new WorktreeManagerOverlay(
      { terminal: { rows: 30 }, requestRender: vi.fn() } as never,
      theme as never,
      inventory,
      done,
    );

    overlay.handleInput(down);
    overlay.handleInput("n");

    expect(done).toHaveBeenCalledWith({
      type: "renew",
      worktreePath: "/repos/repo-feat-topic",
    });
  });

  it("moves up with k", () => {
    const done = vi.fn();
    const overlay = new WorktreeManagerOverlay(
      { terminal: { rows: 30 }, requestRender: vi.fn() } as never,
      theme as never,
      inventory,
      done,
      "/repos/repo-feat-topic",
    );

    overlay.handleInput("k");
    overlay.handleInput("n");

    expect(done).toHaveBeenCalledWith({ type: "renew", worktreePath: "/repos/repo" });
  });

  it.each(["\u001b", "\u0003", "q"])("closes with %j", (key) => {
    const done = vi.fn();
    const overlay = new WorktreeManagerOverlay(
      { terminal: { rows: 30 }, requestRender: vi.fn() } as never,
      theme as never,
      inventory,
      done,
    );

    overlay.handleInput(key);

    expect(done).toHaveBeenCalledWith({ type: "close" });
  });

  it.each([
    ["\r", "focus"],
    ["o", "open"],
    ["p", "pi"],
    ["m", "prompt"],
    ["v", "provision"],
    ["d", "retire"],
    ["c", "copy-path"],
  ])("maps %s to %s", (key, type) => {
    const done = vi.fn();
    const overlay = new WorktreeManagerOverlay(
      { terminal: { rows: 30 }, requestRender: vi.fn() } as never,
      theme as never,
      inventory,
      done,
    );
    overlay.handleInput(key);
    expect(done).toHaveBeenCalledWith({ type, worktreePath: "/repos/repo" });
  });
});
