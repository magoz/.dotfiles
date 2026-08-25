import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import type { ManagedWorktree, WorktreeManagerInventory } from "./manager-domain.ts";
import type { ManagerCommandRunner } from "./manager-service.ts";

export type { ManagerCommandRunner } from "./manager-service.ts";

export type RenewedLease = {
  readonly name: string;
  readonly expiresAt: string;
};

export type RetirementOutcome = {
  readonly removedPath: string;
  readonly releasedLeases: ReadonlyArray<string>;
  readonly branch: "kept" | "deleted" | "retained";
  readonly branchReason?: string;
};

export class ManagerActionError extends Error {
  constructor(
    message: string,
    readonly completedSteps: ReadonlyArray<string> = [],
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** Executes lifecycle-safe actions selected in the worktree manager. */
export class WorktreeActionService {
  constructor(private readonly commands: ManagerCommandRunner) {}

  async focus(target: ManagedWorktree, signal?: AbortSignal): Promise<void> {
    if (target.workspace === undefined) throw new ManagerActionError(`No Herdr workspace is open for ${target.path}`);
    await this.requireSuccess("focus workspace", "herdr", ["workspace", "focus", target.workspace.id], signal);
  }

  async open(
    inventory: WorktreeManagerInventory,
    target: ManagedWorktree,
    signal?: AbortSignal,
  ): Promise<void> {
    if (target.workspace !== undefined) return this.focus(target, signal);
    await this.requireSuccess(
      "open worktree",
      "herdr",
      [
        "worktree",
        "open",
        "--cwd",
        inventory.repository.sourceCheckout,
        "--path",
        target.path,
        "--no-focus",
      ],
      signal,
    );
  }

  async focusOrStartPi(
    target: ManagedWorktree,
    prompt?: string,
    paneId?: string,
    agentPaneId?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (target.workspace === undefined) throw new ManagerActionError(`Open ${target.path} in Herdr before starting Pi`);
    if (target.agent !== undefined) {
      const selectedAgent = agentPaneId === undefined
        ? target.agent
        : target.agents.find((agent) => agent.paneId === agentPaneId);
      if (selectedAgent === undefined) throw new ManagerActionError(`Pi pane not found in ${target.path}: ${agentPaneId}`);
      await this.requireSuccess("focus Pi", "herdr", ["agent", "focus", selectedAgent.paneId], signal);
      if (prompt?.trim()) await this.prompt(target, prompt, selectedAgent.paneId, signal);
      return;
    }

    const selectedPane = paneId ?? await this.resolveOnlyPane(target.workspace.id, signal);
    const agentName = agentNameFor(target.label, target.workspace.id);
    const startArgs = [
      "agent",
      "start",
      agentName,
      "--kind",
      "pi",
      "--pane",
      selectedPane,
      "--timeout",
      "120000",
      "--",
      "--name",
      target.label,
    ];
    const startResult = await this.commands.run(
      "herdr",
      startArgs,
      signal === undefined ? undefined : { signal },
    );
    if (startResult.code === 0) {
      const verified = await this.requireSuccess(
        "verify Pi",
        "herdr",
        ["agent", "get", agentName],
        signal,
      );
      verifyReadyAgent(verified.stdout, agentName, selectedPane);
    } else if (isAgentStartTimeout(startResult)) {
      const detected = await this.requireSuccess(
        "detect Pi after startup timeout",
        "herdr",
        ["agent", "get", selectedPane],
        signal,
      );
      verifyDetectedPi(detected.stdout, selectedPane);
    } else {
      throw new ManagerActionError(`start Pi failed: ${commandFailureDetail(startResult)}`);
    }
    if (prompt?.trim()) {
      await this.requireSuccess("prompt Pi", "herdr", ["agent", "prompt", selectedPane, prompt.trim()], signal);
    }
    await this.requireSuccess("focus workspace", "herdr", ["workspace", "focus", target.workspace.id], signal);
  }

  async listPanes(target: ManagedWorktree, signal?: AbortSignal): Promise<ReadonlyArray<{ id: string; tabId: string }>> {
    if (target.workspace === undefined) return [];
    const result = await this.requireSuccess(
      "list panes",
      "herdr",
      ["pane", "list", "--workspace", target.workspace.id],
      signal,
    );
    return parsePanes(result.stdout, target.workspace.id);
  }

  async prompt(
    target: ManagedWorktree,
    prompt: string,
    paneId?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const text = prompt.trim();
    if (target.agent === undefined) throw new ManagerActionError(`No Pi is running in ${target.path}`);
    if (!text) throw new ManagerActionError("Prompt cannot be empty");
    const selectedAgent = paneId === undefined
      ? target.agent
      : target.agents.find((agent) => agent.paneId === paneId);
    if (selectedAgent === undefined) throw new ManagerActionError(`Pi pane not found in ${target.path}: ${paneId}`);
    await this.requireSuccess("prompt Pi", "herdr", ["agent", "prompt", selectedAgent.paneId, text], signal);
  }

  async provision(
    inventory: WorktreeManagerInventory,
    target: ManagedWorktree,
    ttl: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (target.environment.status === "ready" && target.databases.status === "ready") {
      throw new ManagerActionError(`${target.path} is already provisioned`);
    }
    await this.requireSuccess(
      "provision environment",
      "provision-env",
      [
        "--repo",
        target.path,
        "--source",
        inventory.repository.sourceCheckout,
        "--database",
        "--non-interactive",
        "--label",
        target.label,
        "--ttl",
        ttl,
      ],
      signal,
      { cwd: target.path, timeout: 30 * 60 * 1_000 },
    );
  }

  async fetch(inventory: WorktreeManagerInventory, signal?: AbortSignal): Promise<void> {
    await this.requireSuccess(
      "fetch origin",
      "git",
      ["-C", inventory.repository.sourceCheckout, "fetch", "--prune", "origin"],
      signal,
    );
  }

  async renewDatabases(
    target: ManagedWorktree,
    ttl: string,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<RenewedLease>> {
    for (const name of ["default", "test"] as const) {
      const status = await this.commands.run(
        "sandbox-db",
        ["status", "--worktree", target.path, "--json", "--lease", name],
        signal === undefined ? undefined : { signal },
      );
      const payload = parseStructuredOutput(status.stdout, `database lease ${name} status`) as { status?: string };
      if (payload.status !== "live") {
        throw new ManagerActionError(`Database lease ${name} is ${payload.status ?? "unavailable"}; provision it before renewal`);
      }
    }

    const renewed: RenewedLease[] = [];
    for (const name of ["default", "test"] as const) {
      const result = await this.requireSuccess(
        `renew database lease ${name}`,
        "sandbox-db",
        ["renew", "--worktree", target.path, "--json", "--lease", name, "--ttl", ttl],
        signal,
      );
      const payload = parseStructuredOutput(result.stdout, `database lease ${name} renewal`) as {
        status?: string;
        expires_at?: string;
      };
      if (payload.status !== "renewed" || payload.expires_at === undefined) {
        throw new ManagerActionError(`Database lease ${name} returned an unexpected renewal result`);
      }
      renewed.push({ name, expiresAt: payload.expires_at });
    }
    return renewed;
  }

  async retire(
    inventory: WorktreeManagerInventory,
    target: ManagedWorktree,
    deleteBranch: boolean,
    signal?: AbortSignal,
  ): Promise<RetirementOutcome> {
    if (target.isCurrent) throw new ManagerActionError(`Cannot retire the current worktree: ${target.path}`);
    if (!target.isLinkedWorktree) throw new ManagerActionError(`Cannot retire the primary checkout: ${target.path}`);
    if (target.git.status === "dirty") {
      throw new ManagerActionError(`Cannot retire ${target.path}; it has uncommitted changes`);
    }
    if (target.git.status === "unavailable") {
      throw new ManagerActionError(`Cannot verify Git status for ${target.path}`);
    }
    if (target.workspace === undefined) {
      throw new ManagerActionError(`Cannot retire ${target.path}; it has no authoritative Herdr workspace`);
    }
    const unsafeAgent = target.agents.find((agent) => ["working", "blocked", "unknown"].includes(agent.status));
    if (unsafeAgent !== undefined) {
      throw new ManagerActionError(`Cannot retire ${target.path}; Pi is ${unsafeAgent.status} in pane ${unsafeAgent.paneId}`);
    }

    const freshStatus = await this.requireSuccess(
      "verify clean worktree",
      "git",
      ["-C", target.path, "status", "--porcelain=v1", "--untracked-files=normal"],
      signal,
    );
    if (freshStatus.stdout.split("\n").some(Boolean)) {
      throw new ManagerActionError(`Cannot retire ${target.path}; it has uncommitted changes`);
    }

    const leaseNames: string[] = [];
    for (const name of ["test", "default"] as const) {
      const status = await this.commands.run(
        "sandbox-db",
        ["status", "--worktree", target.path, "--json", "--lease", name],
        signal === undefined ? undefined : { signal },
      );
      const payload = parseStructuredOutput(status.stdout, `database lease ${name} status`) as { status?: string };
      if (payload.status === "live" || payload.status === "missing") {
        leaseNames.push(name);
      } else if (payload.status !== "none") {
        throw new ManagerActionError(`Cannot safely release database lease ${name}: ${payload.status ?? "unknown status"}`);
      }
    }

    const completedSteps: string[] = [];
    const releasedLeases: string[] = [];
    try {
      for (const name of leaseNames) {
        await this.requireSuccess(
          `release database lease ${name}`,
          "sandbox-db",
          ["release", "--worktree", target.path, "--json", "--lease", name],
          signal,
        );
        releasedLeases.push(name);
        completedSteps.push(`released database lease ${name}`);
      }
      await this.requireSuccess(
        "remove Herdr worktree",
        "herdr",
        ["worktree", "remove", "--workspace", target.workspace.id],
        signal,
      );
      completedSteps.push("removed Herdr worktree and workspace");
    } catch (error) {
      if (error instanceof ManagerActionError) {
        throw new ManagerActionError(error.message, completedSteps, error);
      }
      throw new ManagerActionError(String(error), completedSteps, error);
    }

    if (!deleteBranch || target.branch === undefined) {
      return { removedPath: target.path, releasedLeases, branch: "kept" };
    }

    const branchResult = await this.commands.run(
      "git",
      ["-C", inventory.repository.sourceCheckout, "branch", "-d", target.branch],
      signal === undefined ? undefined : { signal },
    );
    if (branchResult.code !== 0) {
      return {
        removedPath: target.path,
        releasedLeases,
        branch: "retained",
        branchReason: commandFailureDetail(branchResult),
      };
    }
    return { removedPath: target.path, releasedLeases, branch: "deleted" };
  }

  private async resolveOnlyPane(workspaceId: string, signal?: AbortSignal): Promise<string> {
    const result = await this.requireSuccess(
      "list panes",
      "herdr",
      ["pane", "list", "--workspace", workspaceId],
      signal,
    );
    const panes = parsePanes(result.stdout, workspaceId);
    if (panes.length !== 1) {
      throw new ManagerActionError(`Workspace ${workspaceId} has ${panes.length} panes; select a pane explicitly`);
    }
    return panes[0]!.id;
  }

  private async requireSuccess(
    operation: string,
    command: string,
    args: ReadonlyArray<string>,
    signal?: AbortSignal,
    extraOptions: ExecOptions = {},
  ): Promise<ExecResult> {
    const options: ExecOptions | undefined = signal === undefined && Object.keys(extraOptions).length === 0
      ? undefined
      : { ...extraOptions, ...(signal === undefined ? {} : { signal }) };
    let result: ExecResult;
    try {
      result = await this.commands.run(command, args, options);
    } catch (cause) {
      throw new ManagerActionError(`${operation} failed: ${String(cause)}`, [], cause);
    }
    if (result.code !== 0) {
      throw new ManagerActionError(`${operation} failed: ${commandFailureDetail(result)}`);
    }
    return result;
  }
}

function parseStructuredOutput(output: string, subject: string): unknown {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new ManagerActionError(`${subject} returned invalid JSON: ${String(error)}`);
  }
}

function parsePanes(output: string, workspaceId: string): ReadonlyArray<{ id: string; tabId: string }> {
  const payload = parseStructuredOutput(output, "Herdr pane list") as {
    result?: { type?: string; panes?: ReadonlyArray<{ pane_id?: string; workspace_id?: string; tab_id?: string }> };
  };
  if (payload.result?.type !== "pane_list" || !Array.isArray(payload.result.panes)) {
    throw new ManagerActionError("Herdr pane list returned an unexpected result");
  }
  return payload.result.panes.flatMap((pane) =>
    pane.workspace_id === workspaceId && pane.pane_id !== undefined && pane.tab_id !== undefined
      ? [{ id: pane.pane_id, tabId: pane.tab_id }]
      : [],
  );
}

function isAgentStartTimeout(result: ExecResult): boolean {
  for (const output of [result.stdout, result.stderr]) {
    try {
      const payload = JSON.parse(output) as { error?: { code?: unknown } };
      if (payload.error?.code === "cli:agent:start:timeout") return true;
    } catch {
      // Unstructured command failures are handled as ordinary start failures.
    }
  }
  return false;
}

function verifyDetectedPi(output: string, paneId: string): void {
  const payload = parseStructuredOutput(output, "Herdr Pi detection") as {
    result?: {
      type?: string;
      agent?: { pane_id?: string; agent?: string; agent_status?: string };
    };
  };
  const agent = payload.result?.agent;
  if (
    payload.result?.type !== "agent_info" ||
    agent?.pane_id !== paneId ||
    agent.agent !== "pi" ||
    !["idle", "working"].includes(agent.agent_status ?? "")
  ) {
    throw new ManagerActionError(`Pi was not safely detected in pane ${paneId}`);
  }
}

function verifyReadyAgent(output: string, agentName: string, paneId: string): void {
  const payload = parseStructuredOutput(output, "Herdr agent verification") as {
    result?: {
      type?: string;
      agent?: {
        pane_id?: string;
        name?: string | null;
        interactive_ready?: boolean;
        launch_pending?: boolean;
      };
    };
  };
  const agent = payload.result?.agent;
  if (
    payload.result?.type !== "agent_info" ||
    agent?.pane_id !== paneId ||
    agent.name !== agentName ||
    agent.interactive_ready !== true ||
    agent.launch_pending === true
  ) {
    throw new ManagerActionError(`Pi ${agentName} is not ready in pane ${paneId}`);
  }
}

function agentNameFor(label: string, workspaceId: string): string {
  const labelSlug = slug(label) || "worktree";
  const workspaceSlug = slug(workspaceId) || "new";
  return `wt-${labelSlug}-${workspaceSlug}`.slice(0, 32).replace(/-+$/g, "");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function commandFailureDetail(result: ExecResult): string {
  return result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
}
