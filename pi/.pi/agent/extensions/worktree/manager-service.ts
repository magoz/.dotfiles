import { lstat, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import type {
  DatabaseLeaseState,
  EnvironmentFileState,
  GitCheckoutState,
  ManagedWorktree,
  WorktreeDatabaseState,
  WorktreeEnvironmentState,
  WorktreeManagerInventory,
} from "./manager-domain.ts";

export interface ManagerCommandRunner {
  run(command: string, args: ReadonlyArray<string>, options?: ExecOptions): Promise<ExecResult>;
}

type ServiceOptions = {
  readonly now?: () => Date;
};

type WorktreeListPayload = {
  readonly result: {
    readonly type: "worktree_list";
    readonly source: {
      readonly repo_name: string;
      readonly repo_root: string;
      readonly source_checkout_path: string;
    };
    readonly worktrees: ReadonlyArray<{
      readonly branch: string | null;
      readonly is_detached: boolean;
      readonly is_linked_worktree: boolean;
      readonly is_prunable: boolean;
      readonly label: string;
      readonly open_workspace_id?: string;
      readonly path: string;
    }>;
  };
};

type WorkspaceListPayload = {
  readonly result: {
    readonly type: "workspace_list";
    readonly workspaces: ReadonlyArray<{
      readonly workspace_id: string;
      readonly label: string;
      readonly focused: boolean;
      readonly pane_count: number;
      readonly tab_count: number;
    }>;
  };
};

type AgentListPayload = {
  readonly result: {
    readonly type: "agent_list";
    readonly agents: ReadonlyArray<{
      readonly workspace_id: string;
      readonly pane_id: string;
      readonly name?: string | null;
      readonly agent?: string;
      readonly agent_status?: string;
      readonly focused?: boolean;
    }>;
  };
};

type LeasePayload = {
  readonly leaseName?: string;
  readonly worktree?: string;
  readonly branchName?: string;
  readonly expiresAt?: string;
};

/** Reads the observable Git, Herdr, Pi, environment, and database state for one repository. */
export class WorktreeManagerService {
  private readonly now: () => Date;

  constructor(
    private readonly commands: ManagerCommandRunner,
    options: ServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async list(cwd: string, signal?: AbortSignal): Promise<WorktreeManagerInventory> {
    const execOptions = signal === undefined ? undefined : { signal };
    const [worktreeResult, workspaceResult, agentResult, leaseResult] = await Promise.all([
      this.commands.run("herdr", ["worktree", "list", "--cwd", cwd], execOptions),
      this.commands.run("herdr", ["workspace", "list"], execOptions),
      this.commands.run("herdr", ["agent", "list"], execOptions),
      this.commands.run("sandbox-db", ["list", "--json"], execOptions),
    ]);

    const worktreePayload = parseCommandJson<WorktreeListPayload>(worktreeResult, "Herdr worktree list");
    const workspacePayload = parseCommandJson<WorkspaceListPayload>(workspaceResult, "Herdr workspace list");
    const agentPayload = parseCommandJson<AgentListPayload>(agentResult, "Herdr agent list");
    const leases = parseCommandJson<ReadonlyArray<LeasePayload>>(leaseResult, "sandbox database list");
    const workspaces = new Map(workspacePayload.result.workspaces.map((workspace) => [workspace.workspace_id, workspace]));
    const agentsByWorkspace = new Map<string, AgentListPayload["result"]["agents"][number][]>();
    for (const agent of agentPayload.result.agents) {
      if (agent.agent !== "pi") continue;
      const existing = agentsByWorkspace.get(agent.workspace_id) ?? [];
      existing.push(agent);
      agentsByWorkspace.set(agent.workspace_id, existing);
    }
    const currentPath = resolve(cwd);
    const now = this.now().getTime();

    const worktrees = await Promise.all(
      worktreePayload.result.worktrees.map(async (entry): Promise<ManagedWorktree> => {
        const workspace = entry.open_workspace_id === undefined
          ? undefined
          : workspaces.get(entry.open_workspace_id);
        const agents = (entry.open_workspace_id === undefined
          ? []
          : agentsByWorkspace.get(entry.open_workspace_id) ?? [])
          .map((agent) => ({
            paneId: agent.pane_id,
            ...(agent.name == null ? {} : { name: agent.name }),
            status: parseAgentStatus(agent.agent_status),
            focused: agent.focused === true,
          }))
          .sort(compareAgents);
        const agent = agents[0];
        const path = resolve(entry.path);
        const [git, environment] = await Promise.all([
          this.loadGitState(path, signal),
          this.loadEnvironmentState(path, signal),
        ]);

        return {
          path,
          label: entry.label,
          ...(entry.branch === null ? {} : { branch: entry.branch }),
          isDetached: entry.is_detached,
          isLinkedWorktree: entry.is_linked_worktree,
          isPrunable: entry.is_prunable,
          isCurrent: currentPath === path || currentPath.startsWith(`${path}${sep}`),
          git,
          ...(workspace === undefined
            ? {}
            : {
                workspace: {
                  id: workspace.workspace_id,
                  label: workspace.label,
                  focused: workspace.focused,
                  paneCount: workspace.pane_count,
                  tabCount: workspace.tab_count,
                },
              }),
          ...(agent === undefined ? {} : { agent }),
          agents,
          environment,
          databases: loadDatabaseState(path, leases, now),
        };
      }),
    );

    return {
      repository: {
        name: worktreePayload.result.source.repo_name,
        root: worktreePayload.result.source.repo_root,
        sourceCheckout: worktreePayload.result.source.source_checkout_path,
      },
      worktrees,
    };
  }

  private async loadGitState(path: string, signal?: AbortSignal): Promise<GitCheckoutState> {
    const options = signal === undefined ? undefined : { signal };
    const status = await this.commands.run(
      "git",
      ["-C", path, "status", "--porcelain=v1", "--untracked-files=normal"],
      options,
    );
    if (status.code !== 0) {
      return {
        status: "unavailable",
        changedFileCount: 0,
        error: status.stderr.trim() || status.stdout.trim() || `exit ${status.code}`,
      };
    }

    const changedFileCount = status.stdout.split("\n").filter(Boolean).length;
    const upstream = await this.commands.run(
      "git",
      ["-C", path, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      options,
    );
    const counts = upstream.code === 0 ? parseAheadBehind(upstream.stdout) : undefined;
    return {
      status: changedFileCount === 0 ? "clean" : "dirty",
      changedFileCount,
      ...(counts === undefined ? {} : counts),
    };
  }

  private async loadEnvironmentState(path: string, signal?: AbortSignal): Promise<WorktreeEnvironmentState> {
    const [development, test, vercelLinked] = await Promise.all([
      this.inspectEnvironmentFile(path, ".env.local", signal),
      this.inspectEnvironmentFile(path, ".env.test", signal),
      fileExists(join(path, ".vercel", "project.json")),
    ]);
    const states = [development, test];
    const status = states.every((state) => state === "ready") && vercelLinked
      ? "ready"
      : states.includes("missing") || !vercelLinked
        ? "missing"
        : "warning";
    return { status, development, test, vercelLinked };
  }

  private async inspectEnvironmentFile(
    checkout: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<EnvironmentFileState> {
    const path = join(checkout, name);
    let metadata;
    try {
      metadata = await lstat(path);
    } catch {
      return "missing";
    }
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) return "insecure";

    const ignored = await this.commands.run(
      "git",
      ["-C", checkout, "check-ignore", "--quiet", "--", name],
      signal === undefined ? undefined : { signal },
    );
    return ignored.code === 0 ? "ready" : "not-ignored";
  }
}

function parseCommandJson<T>(result: ExecResult, subject: string): T {
  if (result.code !== 0) {
    throw new Error(`${subject} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    throw new Error(`${subject} returned invalid JSON: ${String(error)}`);
  }
}

function parseAheadBehind(output: string): { readonly ahead: number; readonly behind: number } | undefined {
  const [ahead, behind] = output.trim().split(/\s+/).map(Number);
  return Number.isFinite(ahead) && Number.isFinite(behind) ? { ahead: ahead!, behind: behind! } : undefined;
}

function parseAgentStatus(status?: string): "idle" | "working" | "blocked" | "done" | "unknown" {
  return status === "idle" || status === "working" || status === "blocked" || status === "done"
    ? status
    : "unknown";
}

function compareAgents(
  left: { readonly paneId: string; readonly status: string; readonly focused: boolean },
  right: { readonly paneId: string; readonly status: string; readonly focused: boolean },
): number {
  if (left.focused !== right.focused) return left.focused ? -1 : 1;
  const rank: Record<string, number> = { working: 0, blocked: 1, idle: 2, done: 3, unknown: 4 };
  const statusDifference = (rank[left.status] ?? 5) - (rank[right.status] ?? 5);
  return statusDifference !== 0 ? statusDifference : left.paneId.localeCompare(right.paneId);
}

function loadDatabaseState(path: string, payloads: ReadonlyArray<LeasePayload>, now: number): WorktreeDatabaseState {
  const leases: DatabaseLeaseState[] = payloads
    .filter((lease) => lease.worktree !== undefined && resolve(lease.worktree) === path)
    .flatMap((lease) => {
      if (lease.leaseName === undefined || lease.branchName === undefined || lease.expiresAt === undefined) return [];
      const remainingMs = new Date(lease.expiresAt).getTime() - now;
      return [{ name: lease.leaseName, branchName: lease.branchName, expiresAt: lease.expiresAt, remainingMs }];
    });
  const names = new Set(leases.map((lease) => lease.name));
  const minimumRemainingMs = leases.length === 0 ? undefined : Math.min(...leases.map((lease) => lease.remainingMs));
  const status = leases.some((lease) => lease.remainingMs <= 0)
    ? "expired"
    : names.has("default") && names.has("test")
      ? "ready"
      : leases.length === 0
        ? "missing"
        : "partial";
  return {
    status,
    leases,
    ...(minimumRemainingMs === undefined ? {} : { minimumRemainingMs }),
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const metadata = await stat(path);
    return metadata.isFile();
  } catch {
    return false;
  }
}
