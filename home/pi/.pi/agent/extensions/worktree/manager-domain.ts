export type GitCheckoutState = {
  readonly status: "clean" | "dirty" | "unavailable";
  readonly changedFileCount: number;
  readonly ahead?: number;
  readonly behind?: number;
  readonly error?: string;
};

export type HerdrWorkspaceState = {
  readonly id: string;
  readonly label: string;
  readonly focused: boolean;
  readonly paneCount: number;
  readonly tabCount: number;
};

export type PiAgentState = {
  readonly paneId: string;
  readonly name?: string;
  readonly status: "idle" | "working" | "blocked" | "done" | "unknown";
  readonly focused: boolean;
};

export type EnvironmentFileState = "ready" | "missing" | "insecure" | "not-ignored";

export type WorktreeEnvironmentState = {
  readonly status: "ready" | "missing" | "warning";
  readonly development: EnvironmentFileState;
  readonly test: EnvironmentFileState;
  readonly vercelLinked: boolean;
};

export type DatabaseLeaseState = {
  readonly name: string;
  readonly branchName: string;
  readonly expiresAt: string;
  readonly remainingMs: number;
};

export type WorktreeDatabaseState = {
  readonly status: "ready" | "partial" | "missing" | "expired";
  readonly leases: ReadonlyArray<DatabaseLeaseState>;
  readonly minimumRemainingMs?: number;
};

export type ManagedWorktree = {
  readonly path: string;
  readonly label: string;
  readonly branch?: string;
  readonly isDetached: boolean;
  readonly isLinkedWorktree: boolean;
  readonly isPrunable: boolean;
  readonly isCurrent: boolean;
  readonly git: GitCheckoutState;
  readonly workspace?: HerdrWorkspaceState;
  /** Preferred Pi target: focused first, then active, then idle. */
  readonly agent?: PiAgentState;
  readonly agents: ReadonlyArray<PiAgentState>;
  readonly environment: WorktreeEnvironmentState;
  readonly databases: WorktreeDatabaseState;
};

export type WorktreeManagerInventory = {
  readonly repository: {
    readonly name: string;
    readonly root: string;
    readonly sourceCheckout: string;
  };
  readonly worktrees: ReadonlyArray<ManagedWorktree>;
};
