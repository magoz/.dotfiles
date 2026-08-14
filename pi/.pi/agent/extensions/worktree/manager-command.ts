import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ManagerActionError, type WorktreeActionService } from "./manager-actions.ts";
import type { ManagedWorktree, WorktreeManagerInventory } from "./manager-domain.ts";
import { showWorktreeManagerOverlay, type WorktreeManagerAction } from "./manager-overlay.ts";
import type { WorktreeManagerService } from "./manager-service.ts";

export type WorktreeManagerDependencies = {
  readonly inventory: Pick<WorktreeManagerService, "list">;
  readonly actions: Pick<
    WorktreeActionService,
    | "focus"
    | "open"
    | "focusOrStartPi"
    | "listPanes"
    | "prompt"
    | "provision"
    | "fetch"
    | "renewDatabases"
    | "retire"
  >;
  readonly showOverlay?: typeof showWorktreeManagerOverlay;
  readonly requestCreate: (task: string) => void;
};

/** Run the interactive manager, refreshing inventory after every completed action. */
export async function runWorktreeManager(
  ctx: ExtensionCommandContext,
  dependencies: WorktreeManagerDependencies,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/worktrees requires Pi's interactive TUI mode", "error");
    return;
  }

  const showOverlay = dependencies.showOverlay ?? showWorktreeManagerOverlay;
  let selectedPath: string | undefined;
  while (true) {
    let inventory: WorktreeManagerInventory;
    try {
      ctx.ui.setStatus("worktrees", ctx.ui.theme.fg("accent", "worktrees:loading"));
      inventory = await dependencies.inventory.list(ctx.cwd);
    } catch (error) {
      ctx.ui.notify(errorMessage(error), "error");
      return;
    } finally {
      ctx.ui.setStatus("worktrees", undefined);
    }

    const action = await showOverlay(ctx, inventory, selectedPath);
    if (action.type === "close") return;
    if ("worktreePath" in action) selectedPath = action.worktreePath;

    try {
      const shouldContinue = await executeAction(ctx, dependencies, inventory, action);
      if (!shouldContinue) return;
    } catch (error) {
      const detail = error instanceof ManagerActionError && error.completedSteps.length > 0
        ? `${error.message}\nCompleted before failure: ${error.completedSteps.join(", ")}`
        : errorMessage(error);
      ctx.ui.notify(detail, "error");
    } finally {
      ctx.ui.setStatus("worktrees", undefined);
    }
  }
}

async function executeAction(
  ctx: ExtensionCommandContext,
  dependencies: WorktreeManagerDependencies,
  inventory: WorktreeManagerInventory,
  action: WorktreeManagerAction,
): Promise<boolean> {
  switch (action.type) {
    case "refresh":
      return true;
    case "create": {
      const task = (await ctx.ui.input("Create worktree", "Describe the work to start"))?.trim();
      if (!task) return true;
      dependencies.requestCreate(task);
      return false;
    }
    case "fetch":
      await withStatus(ctx, "fetching", () => dependencies.actions.fetch(inventory));
      ctx.ui.notify(`Fetched and pruned origin for ${inventory.repository.name}`, "info");
      return true;
    case "copy-path": {
      const target = requireTarget(inventory, action.worktreePath);
      ctx.ui.setEditorText(target.path);
      ctx.ui.notify("Worktree path loaded into the editor", "info");
      return false;
    }
    case "focus": {
      let target = requireTarget(inventory, action.worktreePath);
      if (target.workspace === undefined) {
        await withStatus(ctx, "opening", () => dependencies.actions.open(inventory, target));
        const refreshed = await dependencies.inventory.list(ctx.cwd);
        target = requireTarget(refreshed, action.worktreePath);
      }
      await withStatus(ctx, "focusing", () => dependencies.actions.focus(target));
      return false;
    }
    case "open": {
      const target = requireTarget(inventory, action.worktreePath);
      const wasClosed = target.workspace === undefined;
      await withStatus(ctx, wasClosed ? "opening" : "focusing", () =>
        dependencies.actions.open(inventory, target),
      );
      ctx.ui.notify(wasClosed ? `Opened ${target.label} in Herdr` : `Focused ${target.label}`, "info");
      return wasClosed;
    }
    case "pi": {
      let target = requireTarget(inventory, action.worktreePath);
      if (target.workspace === undefined) {
        await withStatus(ctx, "opening", () => dependencies.actions.open(inventory, target));
        const refreshed = await dependencies.inventory.list(ctx.cwd);
        target = requireTarget(refreshed, action.worktreePath);
      }
      let paneId: string | undefined;
      let agentPaneId: string | undefined;
      if (target.agent === undefined) {
        const panes = await dependencies.actions.listPanes(target);
        if (panes.length > 1) {
          const choice = await ctx.ui.select(
            `Start Pi in ${target.label}`,
            panes.map((pane) => `${pane.id} (${pane.tabId})`),
          );
          if (choice === undefined) return true;
          paneId = choice.split(" ", 1)[0];
        }
      } else if (target.agents.length > 1) {
        agentPaneId = await selectPiAgent(ctx, target, `Focus Pi — ${target.label}`);
        if (agentPaneId === undefined) return true;
      }
      await withStatus(ctx, target.agent === undefined ? "starting-pi" : "focusing-pi", () =>
        dependencies.actions.focusOrStartPi(target, undefined, paneId, agentPaneId),
      );
      return false;
    }
    case "prompt": {
      const target = requireTarget(inventory, action.worktreePath);
      const prompt = (await ctx.ui.input(`Prompt Pi — ${target.label}`, "Task or follow-up"))?.trim();
      if (!prompt) return true;
      if (target.agent === undefined) {
        ctx.ui.notify(`No Pi is running in ${target.label}; start it with p first`, "warning");
        return true;
      }
      const agentPaneId = target.agents.length > 1
        ? await selectPiAgent(ctx, target, `Prompt Pi — ${target.label}`)
        : target.agent.paneId;
      if (agentPaneId === undefined) return true;
      await withStatus(ctx, "prompting", () => dependencies.actions.prompt(target, prompt, agentPaneId));
      const selectedAgent = target.agents.find((agent) => agent.paneId === agentPaneId) ?? target.agent;
      ctx.ui.notify(`Prompt submitted to ${selectedAgent.name ?? selectedAgent.paneId}`, "info");
      return true;
    }
    case "renew": {
      const target = requireTarget(inventory, action.worktreePath);
      const ttlInput = await ctx.ui.input(`Renew databases — ${target.label}`, "TTL, maximum 7d");
      if (ttlInput === undefined) return true;
      const ttl = ttlInput.trim() || "7d";
      const confirmed = await ctx.ui.confirm(
        "Renew both database leases?",
        `${target.path}\ndefault + test → ${ttl}`,
      );
      if (!confirmed) return true;
      const renewed = await withStatus(ctx, "renewing", () => dependencies.actions.renewDatabases(target, ttl));
      ctx.ui.notify(
        `Renewed ${renewed.map((lease) => lease.name).join(", ")} through ${renewed[0]?.expiresAt ?? ttl}`,
        "info",
      );
      return true;
    }
    case "provision": {
      const target = requireTarget(inventory, action.worktreePath);
      const ttlInput = await ctx.ui.input(`Provision ${target.label}`, "Database TTL, maximum 7d");
      if (ttlInput === undefined) return true;
      const ttl = ttlInput.trim() || "7d";
      const confirmed = await ctx.ui.confirm(
        "Provision environment and databases?",
        `${target.path}\nPull Development + test variables and create isolated databases. Existing-file conflicts fail safely.`,
      );
      if (!confirmed) return true;
      await withStatus(ctx, "provisioning", () => dependencies.actions.provision(inventory, target, ttl));
      ctx.ui.notify(`Provisioned ${target.label}`, "info");
      return true;
    }
    case "retire": {
      const target = requireTarget(inventory, action.worktreePath);
      if (target.isCurrent) {
        ctx.ui.notify("The current worktree cannot be retired", "warning");
        return true;
      }
      if (!target.isLinkedWorktree) {
        ctx.ui.notify("The primary checkout cannot be retired from this manager", "warning");
        return true;
      }
      if (target.git.status === "dirty") {
        ctx.ui.notify(`${target.label} has ${target.git.changedFileCount} uncommitted change(s)`, "warning");
        return true;
      }
      const unsafeAgent = target.agents.find((agent) => ["working", "blocked", "unknown"].includes(agent.status));
      if (unsafeAgent !== undefined) {
        ctx.ui.notify(`Pi is ${unsafeAgent.status} in ${target.label}; settle it before retirement`, "warning");
        return true;
      }
      const choices = target.branch === undefined
        ? ["Retire worktree", "Cancel"]
        : ["Retire worktree only", "Retire and delete merged local branch", "Cancel"];
      const choice = await ctx.ui.select(`Retire ${target.label}?`, choices);
      if (choice === undefined || choice === "Cancel") return true;
      const deleteBranch = choice === "Retire and delete merged local branch";
      const leaseNames = target.databases.leases.map((lease) => lease.name).join(", ") || "none recorded";
      const confirmed = await ctx.ui.confirm(
        "Confirm coordinated retirement",
        `${target.path}\nBranch: ${target.branch ?? "detached"}\nPi: ${target.agent?.status ?? "none"}\nSandbox databases: ${leaseNames}\nCleanup checks default + test, deletes any provisioned Neon branches and removes their leased URL keys.${deleteBranch ? "\nDelete the Git branch only if Git reports it merged." : ""}`,
      );
      if (!confirmed) return true;
      const outcome = await withStatus(ctx, "retiring", () => dependencies.actions.retire(inventory, target, deleteBranch));
      const branchDetail = outcome.branch === "deleted"
        ? "\nDeleted merged local branch."
        : outcome.branch === "retained"
          ? `\nRetained branch: ${outcome.branchReason}`
          : "";
      ctx.ui.notify(`Retired ${outcome.removedPath}${branchDetail}`, outcome.branch === "retained" ? "warning" : "info");
      return true;
    }
    case "close":
      return false;
    default:
      return casesHandled(action);
  }
}

async function selectPiAgent(
  ctx: ExtensionCommandContext,
  target: ManagedWorktree,
  title: string,
): Promise<string | undefined> {
  const options = target.agents.map((agent) => ({
    paneId: agent.paneId,
    label: `${agent.name ?? "Pi"} — ${agent.status} (${agent.paneId})`,
  }));
  const selected = await ctx.ui.select(title, options.map((option) => option.label));
  return options.find((option) => option.label === selected)?.paneId;
}

function requireTarget(inventory: WorktreeManagerInventory, path: string): ManagedWorktree {
  const target = inventory.worktrees.find((worktree) => worktree.path === path);
  if (target === undefined) throw new ManagerActionError(`Worktree disappeared during refresh: ${path}`);
  return target;
}

async function withStatus<T>(
  ctx: ExtensionCommandContext,
  status: string,
  operation: () => Promise<T>,
): Promise<T> {
  ctx.ui.setStatus("worktrees", ctx.ui.theme.fg("accent", `worktrees:${status}`));
  return operation();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function casesHandled(value: never): never {
  throw new Error(`Unhandled worktree manager action: ${String(value)}`);
}
