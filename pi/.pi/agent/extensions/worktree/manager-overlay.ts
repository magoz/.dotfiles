import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import type { ManagedWorktree, WorktreeManagerInventory } from "./manager-domain.ts";

export type WorktreeManagerAction =
  | { readonly type: "close" }
  | { readonly type: "refresh" }
  | { readonly type: "create" }
  | { readonly type: "fetch" }
  | {
      readonly type: "focus" | "open" | "pi" | "prompt" | "renew" | "provision" | "retire" | "copy-path";
      readonly worktreePath: string;
    };

export async function showWorktreeManagerOverlay(
  ctx: ExtensionContext,
  inventory: WorktreeManagerInventory,
  selectedPath?: string,
): Promise<WorktreeManagerAction> {
  return ctx.ui.custom<WorktreeManagerAction>(
    (tui, theme, _keybindings, done) =>
      new WorktreeManagerOverlay(tui, theme, inventory, done, selectedPath),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "94%",
        maxHeight: "88%",
        minWidth: 78,
      },
    },
  );
}

/** Keyboard-driven repository worktree and environment dashboard. */
export class WorktreeManagerOverlay {
  private selectedIndex: number;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly inventory: WorktreeManagerInventory,
    private readonly done: (action: WorktreeManagerAction) => void,
    selectedPath?: string,
  ) {
    const requestedIndex = inventory.worktrees.findIndex((worktree) => worktree.path === selectedPath);
    this.selectedIndex = requestedIndex >= 0 ? requestedIndex : 0;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || matchesKey(data, "q")) {
      this.done({ type: "close" });
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
      this.move(-1);
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
      this.move(1);
      return;
    }
    if (matchesKey(data, Key.enter)) return this.completeForSelected("focus");
    if (data === "a") return this.done({ type: "create" });
    if (data === "f") return this.done({ type: "fetch" });
    if (data === "r") return this.done({ type: "refresh" });
    if (data === "o") return this.completeForSelected("open");
    if (data === "p") return this.completeForSelected("pi");
    if (data === "m") return this.completeForSelected("prompt");
    if (data === "n") return this.completeForSelected("renew");
    if (data === "v") return this.completeForSelected("provision");
    if (data === "d") return this.completeForSelected("retire");
    if (data === "c") return this.completeForSelected("copy-path");
  }

  render(width: number): string[] {
    const outerWidth = Math.max(20, width);
    const innerWidth = Math.max(18, outerWidth - 2);
    const bodyHeight = this.bodyHeight();
    const body = innerWidth >= 82
      ? this.renderColumns(innerWidth, bodyHeight)
      : this.renderList(innerWidth, bodyHeight);
    const count = this.inventory.worktrees.length;
    const header = spread(
      this.theme.fg("accent", this.theme.bold(`Worktrees — ${this.inventory.repository.name}`)),
      this.theme.fg("muted", `${count} checkout${count === 1 ? "" : "s"}`),
      innerWidth,
    );

    return [
      border(this.theme, "top", innerWidth),
      frame(this.theme, header, innerWidth),
      border(this.theme, "middle", innerWidth),
      ...body.map((line) => frame(this.theme, line, innerWidth)),
      border(this.theme, "middle", innerWidth),
      frame(
        this.theme,
        this.theme.fg("dim", "↑↓/jk select · Enter focus · a create · o open · p start/focus Pi"),
        innerWidth,
      ),
      frame(
        this.theme,
        this.theme.fg("dim", "m prompt Pi · n renew leases · v provision · f fetch · d retire"),
        innerWidth,
      ),
      frame(
        this.theme,
        this.theme.fg("dim", "c load path · r refresh · q/Esc close"),
        innerWidth,
      ),
      border(this.theme, "bottom", innerWidth),
    ].map((line) => truncateToWidth(line, outerWidth, ""));
  }

  invalidate(): void {}

  private renderColumns(width: number, height: number): string[] {
    const listWidth = Math.floor((width - 1) * 0.58);
    const detailWidth = width - listWidth - 1;
    const separator = this.theme.fg("borderMuted", "│");
    const list = this.renderList(listWidth, height);
    const details = this.renderDetails(detailWidth, height);
    return Array.from({ length: height }, (_, index) =>
      `${fit(list[index] ?? "", listWidth)}${separator}${fit(details[index] ?? "", detailWidth)}`,
    );
  }

  private renderList(width: number, height: number): string[] {
    if (this.inventory.worktrees.length === 0) {
      return pad([this.theme.fg("dim", "No worktrees found")], height);
    }
    this.selectedIndex = clamp(this.selectedIndex, 0, this.inventory.worktrees.length - 1);
    const start = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(height / 2), Math.max(0, this.inventory.worktrees.length - height)),
    );
    const lines: string[] = [];
    for (let index = start; index < Math.min(this.inventory.worktrees.length, start + height); index += 1) {
      const worktree = this.inventory.worktrees[index]!;
      const cursor = index === this.selectedIndex ? "›" : " ";
      const current = worktree.isCurrent ? "●" : " ";
      const workspace = worktree.workspace === undefined ? "closed" : worktree.workspace.focused ? "focused" : "open";
      const row = `${cursor} ${current} ${worktree.label}  ${worktree.branch ?? "(detached)"}  ${gitSummary(worktree)}  ${workspace}  ${agentSummary(worktree)}  env:${worktree.environment.status}  db:${databaseSummary(worktree)}`;
      lines.push(
        index === this.selectedIndex
          ? this.theme.fg("accent", this.theme.bold(fit(row, width)))
          : fit(row, width),
      );
    }
    return pad(lines, height);
  }

  private renderDetails(width: number, height: number): string[] {
    const worktree = this.selected();
    if (worktree === undefined) return pad([this.theme.fg("dim", "No selection")], height);
    const lines = [
      this.theme.fg("accent", this.theme.bold(worktree.label)),
      "",
      `${this.theme.fg("muted", "Branch:")} ${worktree.branch ?? "(detached HEAD)"}`,
      `${this.theme.fg("muted", "Git:")} ${gitSummary(worktree)}${upstreamSummary(worktree)}`,
      `${this.theme.fg("muted", "Workspace:")} ${worktree.workspace === undefined ? "closed" : worktree.workspace.focused ? "focused" : "open"}`,
      `${this.theme.fg("muted", "Pi:")} ${agentSummary(worktree)}`,
      ...worktree.agents.map((agent) =>
        `${this.theme.fg("muted", `  ${agent.name ?? agent.paneId}:`)} ${agent.status}${agent.focused ? " (focused)" : ""}`,
      ),
      `${this.theme.fg("muted", "Environment:")} ${worktree.environment.status}`,
      `${this.theme.fg("muted", "  Development:")} ${worktree.environment.development}`,
      `${this.theme.fg("muted", "  Test:")} ${worktree.environment.test}`,
      `${this.theme.fg("muted", "  Vercel:")} ${worktree.environment.vercelLinked ? "linked" : "missing"}`,
      `${this.theme.fg("muted", "Databases:")} ${databaseSummary(worktree)}`,
      ...worktree.databases.leases.map((lease) =>
        `${this.theme.fg("muted", `  ${lease.name}:`)} ${formatRemaining(lease.remainingMs)}`,
      ),
      "",
      this.theme.fg("muted", "Path:"),
      ...wrapPlain(worktree.path, Math.max(1, width)),
    ];
    if (worktree.isPrunable) lines.splice(2, 0, this.theme.fg("warning", "Git marks this worktree prunable"));
    return pad(lines.map((line) => truncateToWidth(line, width, "")), height);
  }

  private completeForSelected(type: Extract<WorktreeManagerAction, { worktreePath: string }>['type']): void {
    const worktree = this.selected();
    if (worktree !== undefined) this.done({ type, worktreePath: worktree.path });
  }

  private move(delta: number): void {
    if (this.inventory.worktrees.length === 0) return;
    this.selectedIndex = clamp(this.selectedIndex + delta, 0, this.inventory.worktrees.length - 1);
    this.tui.requestRender();
  }

  private selected(): ManagedWorktree | undefined {
    return this.inventory.worktrees[this.selectedIndex];
  }

  private bodyHeight(): number {
    const terminalRows = this.tui.terminal.rows ?? 30;
    return clamp(Math.floor(terminalRows * 0.58), 10, 28);
  }
}

function gitSummary(worktree: ManagedWorktree): string {
  if (worktree.git.status === "clean") return "clean";
  if (worktree.git.status === "dirty") return `${worktree.git.changedFileCount} changed`;
  return "Git unavailable";
}

function agentSummary(worktree: ManagedWorktree): string {
  if (worktree.agents.length > 1) return `${worktree.agents.length} Pi (${worktree.agent?.status ?? "unknown"})`;
  return worktree.agent?.status ?? (worktree.workspace === undefined ? "closed" : "no Pi");
}

function databaseSummary(worktree: ManagedWorktree): string {
  if (worktree.databases.minimumRemainingMs !== undefined && worktree.databases.status === "ready") {
    return formatRemaining(worktree.databases.minimumRemainingMs);
  }
  return worktree.databases.status;
}

function upstreamSummary(worktree: ManagedWorktree): string {
  if (worktree.git.ahead === undefined || worktree.git.behind === undefined) return "";
  return ` (↑${worktree.git.ahead} ↓${worktree.git.behind})`;
}

function formatRemaining(milliseconds: number): string {
  if (milliseconds <= 0) return "expired";
  const hours = Math.ceil(milliseconds / 3_600_000);
  return hours >= 48 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
}

function wrapPlain(text: string, width: number): string[] {
  const lines: string[] = [];
  for (let offset = 0; offset < text.length; offset += width) lines.push(text.slice(offset, offset + width));
  return lines.length === 0 ? [""] : lines;
}

function spread(left: string, right: string, width: number): string {
  return `${left}${" ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)))}${right}`;
}

function fit(text: string, width: number): string {
  const truncated = truncateToWidth(text, Math.max(0, width), "");
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function frame(theme: Theme, content: string, width: number): string {
  return `${theme.fg("borderAccent", "│")}${fit(content, width)}${theme.fg("borderAccent", "│")}`;
}

function border(theme: Theme, position: "top" | "middle" | "bottom", width: number): string {
  const characters = position === "top" ? ["┌", "┐"] : position === "bottom" ? ["└", "┘"] : ["├", "┤"];
  return theme.fg(position === "middle" ? "borderMuted" : "borderAccent", `${characters[0]}${"─".repeat(width)}${characters[1]}`);
}

function pad(lines: ReadonlyArray<string>, height: number): string[] {
  const result = [...lines];
  while (result.length < height) result.push("");
  return result.slice(0, height);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
