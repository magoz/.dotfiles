import { Schema } from "effect"
import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, open, realpath, rename } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve, sep } from "node:path"

// Deliberately independent of the Pi-only dashboard inventory. Never inspect env files.
const Text = Schema.String.pipe(Schema.filter((s) => s.length > 0 && s.length < 4096 && !/[\x00-\x1f\x7f]/.test(s) && !s.includes("://")))
const ID = Text.pipe(Schema.filter((s) => /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s)))
const Path = Text.pipe(Schema.filter(isAbsolute))
const LeaseName = Text.pipe(Schema.filter((s) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s)))
const Worktrees = Schema.Struct({ result: Schema.Struct({
  type: Schema.Literal("worktree_list"),
  source: Schema.Struct({ repo_root: Path, source_checkout_path: Path }),
  worktrees: Schema.Array(Schema.Struct({
    path: Path, branch: Schema.NullOr(Text), is_detached: Schema.Boolean,
    is_linked_worktree: Schema.Boolean, is_prunable: Schema.Boolean,
    open_workspace_id: Schema.optional(ID)
  }))
}) })
const Workspaces = Schema.Struct({ result: Schema.Struct({
  type: Schema.Literal("workspace_list"),
  workspaces: Schema.Array(Schema.Struct({ workspace_id: ID }))
}) })
const Agents = Schema.Struct({ result: Schema.Struct({
  type: Schema.Literal("agent_list"),
  agents: Schema.Array(Schema.Struct({ workspace_id: ID, pane_id: ID,
    agent: Schema.optional(Schema.String), agent_status: Schema.optional(Schema.String),
    launch_pending: Schema.optional(Schema.Boolean)
  }))
}) })
const Leases = Schema.Array(Schema.Struct({ worktree: Path, leaseName: LeaseName, branchId: ID }))
const LeaseStatus = Schema.Struct({ status: Schema.Literal("live", "missing", "none"),
  lease: LeaseName, worktree: Path, branch_id: Schema.optional(ID), releasable: Schema.optional(Schema.Boolean) })
const Released = Schema.Struct({ status: Schema.Literal("released", "already-gone"), lease: LeaseName, branch_id: ID })
const Renewed = Schema.Struct({ status: Schema.Literal("renewed"), lease: LeaseName, expires_at: Text })

export interface CommandResult { readonly code: number | null; readonly stdout: string }
export type ManagerRunner = (command: string, args: ReadonlyArray<string>, signal?: AbortSignal) => Promise<CommandResult>
export class ManagerError extends Error {}
function refuse(message: string): never { throw new ManagerError(message) }
function decode<A, I>(schema: Schema.Schema<A, I>, output: string): A {
  try { return Schema.decodeUnknownSync(Schema.parseJson(schema))(output) }
  catch { return refuse("Invalid authoritative response; no automatic retry") }
}
async function canonical(path: string): Promise<string> {
  try { return await realpath(path) } catch { return refuse("Checkout identity unavailable") }
}
function unique(values: ReadonlyArray<string>) {
  if (new Set(values).size !== values.length) refuse("Ambiguous authoritative identities")
}
const within = (path: string, parent: string) => path === parent || path.startsWith(parent + sep)

export interface ManagedCheckout {
  readonly path: string
  readonly branch: string | null
  readonly workspace: string | null
  readonly linked: boolean
  readonly current: boolean
  readonly git: "clean" | "dirty" | "unavailable"
  readonly agents: ReadonlyArray<{ readonly kind: "pi" | "opencode" | "unknown"; readonly status: "idle" | "done" | "working" | "blocked" | "unknown" }>
  readonly leases: ReadonlyArray<{ readonly name: string; readonly id: string }>
}
export interface Inventory { readonly source: string; readonly root: string; readonly worktrees: ReadonlyArray<ManagedCheckout> }
export interface Target { readonly path: string; readonly workspace: string }
export interface Plan extends Target { readonly releases: ReadonlyArray<string>; readonly token: string }
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export class WorktreeManager {
  constructor(private readonly run: ManagerRunner,
    private readonly receiptDir = join(homedir(), ".local", "state", "worktree-manager")) {}

  private async command(command: string, args: ReadonlyArray<string>, signal?: AbortSignal, allowStatusExit = false) {
    signal?.throwIfAborted()
    let result: CommandResult
    try { result = await this.run(command, args, signal) }
    catch { return refuse("Command cancelled or unavailable; preserve resources and inspect receipt before retrying") }
    if (result.code !== 0 && !(allowStatusExit && result.code === 1)) refuse("Command failed; preserve resources and inspect receipt before retrying")
    if (result.stdout.length > 1024 * 1024) refuse("Authoritative response exceeded limit")
    return result
  }
  private async json<A, I>(schema: Schema.Schema<A, I>, command: string, args: ReadonlyArray<string>, signal?: AbortSignal) {
    return decode(schema, (await this.command(command, args, signal)).stdout)
  }

  async list(cwd: string, signal?: AbortSignal): Promise<Inventory> {
    const current = await canonical(cwd)
    const wt = await this.json(Worktrees, "herdr", ["worktree", "list", "--cwd", current], signal)
    const ws = await this.json(Workspaces, "herdr", ["workspace", "list"], signal)
    const agents = await this.json(Agents, "herdr", ["agent", "list"], signal)
    const leases = await this.json(Leases, "sandbox-db", ["list", "--json"], signal)
    unique(wt.result.worktrees.map((w) => w.path))
    unique(wt.result.worktrees.flatMap((w) => w.open_workspace_id ? [w.open_workspace_id] : []))
    unique(ws.result.workspaces.map((w) => w.workspace_id))
    unique(agents.result.agents.map((a) => a.pane_id))
    unique(leases.map((l) => JSON.stringify([l.worktree, l.leaseName])))
    const source = await canonical(wt.result.source.source_checkout_path)
    const root = await canonical(wt.result.source.repo_root)
    const sourceTop = (await this.command("git", ["-C", current, "rev-parse", "--show-toplevel"], signal)).stdout.trim()
    if (await canonical(sourceTop) !== source) refuse("Herdr source checkout mismatch")
    const worktrees: ManagedCheckout[] = []
    for (const entry of wt.result.worktrees) {
      let git: ManagedCheckout["git"] = "unavailable"
      try {
        if (await canonical(entry.path) === entry.path) {
          const status = await this.command("git", ["-C", entry.path, "status", "--porcelain=v1", "--untracked-files=all"], signal)
          git = status.stdout.length === 0 ? "clean" : "dirty"
        }
      } catch { signal?.throwIfAborted() }
      const workspace = ws.result.workspaces.find((w) => w.workspace_id === entry.open_workspace_id)
      worktrees.push({ path: entry.path, branch: entry.branch,
        workspace: workspace?.workspace_id ?? null,
        linked: entry.is_linked_worktree && !entry.is_detached && !entry.is_prunable,
        current: within(current, entry.path), git,
        agents: agents.result.agents.filter((a) => a.workspace_id === entry.open_workspace_id).map((a) => ({
          kind: a.agent === "pi" || a.agent === "opencode" ? a.agent : "unknown",
          status: !a.launch_pending && (a.agent_status === "idle" || a.agent_status === "done" || a.agent_status === "working" || a.agent_status === "blocked") ? a.agent_status : "unknown"
        })),
        leases: leases.filter((l) => l.worktree === entry.path).map((l) => ({ name: l.leaseName, id: l.branchId }))
      })
    }
    return { source, root, worktrees }
  }

  private async target(cwd: string, target: Target, signal?: AbortSignal) {
    Schema.decodeUnknownSync(Schema.Struct({ path: Path, workspace: ID }))(target)
    if (await canonical(target.path) !== target.path || resolve(target.path) !== target.path) refuse("Use the canonical exact checkout path")
    const inventory = await this.list(cwd, signal)
    const selected = inventory.worktrees.find((w) => w.path === target.path)
    if (!selected || selected.workspace !== target.workspace) refuse("Exact checkout/workspace identity not found")
    if (!selected.linked || selected.path === inventory.root) refuse("Not a linked checkout; primary/detached/prunable refused")
    // Independently bind Herdr's path to Git's linked checkout and common repository.
    const top = (await this.command("git", ["-C", target.path, "rev-parse", "--show-toplevel"], signal)).stdout.trim()
    const common = (await this.command("git", ["-C", target.path, "rev-parse", "--path-format=absolute", "--git-common-dir"], signal)).stdout.trim()
    const sourceCommon = (await this.command("git", ["-C", inventory.source, "rev-parse", "--path-format=absolute", "--git-common-dir"], signal)).stdout.trim()
    const branch = (await this.command("git", ["-C", target.path, "branch", "--show-current"], signal)).stdout.trim()
    if (!selected.branch || branch !== selected.branch) refuse("Git branch identity mismatch")
    const gitFile = await lstat(join(target.path, ".git"))
    if (await canonical(top) !== target.path || await canonical(common) !== await canonical(sourceCommon) || !gitFile.isFile()) refuse("Git linked checkout identity mismatch")
    const head = (await this.command('git', ['-C', target.path, 'rev-parse', 'HEAD'], signal)).stdout.trim()
    if (!/^[a-f0-9]{40,64}$/.test(head)) refuse('Git head identity unavailable')
    return { inventory, selected, head }
  }

  private async statuses(selected: ManagedCheckout, signal?: AbortSignal) {
    const names = [...new Set(["test", "default", ...selected.leases.map((l) => l.name)])]
    const statuses: Array<{ name: string; status: "live" | "missing" | "none"; id?: string }> = []
    // Query every lease before ANY release. Missing/none intentionally exit 1.
    for (const name of names) {
      const result = await this.command("sandbox-db", ["status", "--worktree", selected.path, "--json", "--lease", name], signal, true)
      const status = decode(LeaseStatus, result.stdout)
      const recorded = selected.leases.find((l) => l.name === name)
      if (status.lease !== name || status.worktree !== selected.path ||
          (status.status === "none" ? recorded !== undefined : !recorded || status.branch_id !== recorded.id) ||
          (status.status === "live" && result.code !== 0)) refuse("Database lease identity/status mismatch")
      if (status.status !== 'none' && status.releasable !== true) refuse('Database lease is not safely releasable; nothing deleted')
      statuses.push({ name, status: status.status, id: status.branch_id })
    }
    return statuses
  }

  private async retirement(cwd: string, target: Target, signal?: AbortSignal) {
    const state = await this.target(cwd, target, signal)
    const w = state.selected
    if (w.current) refuse("Cannot retire current checkout or its parent")
    if (w.git !== "clean") refuse("Checkout dirty or unavailable")
    if (w.agents.some((a) => a.kind === "unknown" || !["idle", "done"].includes(a.status))) refuse("Agent working, blocked, or unknown; all harnesses must be idle/done")
    return { ...state, statuses: await this.statuses(w, signal) }
  }

  async plan(cwd: string, target: Target, signal?: AbortSignal): Promise<Plan> {
    const state = await this.retirement(cwd, target, signal)
    return { ...target, releases: state.statuses.filter((s) => s.status !== "none").map((s) => s.name), token: fingerprint([target, state.inventory.root, state.selected.branch, state.head, state.statuses]) }
  }

  // Exclusive, append-only, fsync'd journal: a stale/incomplete attempt blocks reuse.
  private async receipt(target: Target, operation: string) {
    await mkdir(this.receiptDir, { recursive: true, mode: 0o700 })
    const dir = await lstat(this.receiptDir)
    if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) !== 0) refuse("Receipt directory must be private")
    const path = join(this.receiptDir, createHash("sha256").update(target.path).digest("hex") + ".jsonl")
    let file
    try { file = await open(path, "wx", 0o600) } catch { return refuse("Existing receipt: inspect partial completion and archive it manually before another mutation") }
    const append = async (step: string, details: ReadonlyArray<string> = []) => {
      await file.writeFile(JSON.stringify({ operation, path: target.path, workspace: target.workspace, step, details, at: new Date().toISOString() }) + "\n")
      await file.sync()
    }
    try {
      await append("prepared")
      const directory = await open(this.receiptDir, "r")
      try { await directory.sync() } finally { await directory.close() }
    } catch (error) { await file.close(); throw error }
    const complete = async () => {
      await append("complete")
      const archived = path.replace(/\.jsonl$/, `.${randomUUID()}.complete.jsonl`)
      await rename(path, archived)
      const directory = await open(this.receiptDir, "r")
      try { await directory.sync() } finally { await directory.close() }
      return archived
    }
    return { path, append, complete, close: () => file.close() }
  }

  async renew(cwd: string, target: Target, ttl: string, signal?: AbortSignal) {
    if (!/^[1-9][0-9]{0,3}[mhd]$/.test(ttl)) refuse("TTL must be a positive duration such as 7d")
    const { selected } = await this.target(cwd, target, signal)
    const statuses = await this.statuses(selected, signal)
    if (statuses.some((s) => s.status !== "live")) refuse("All recorded/default/test leases must be live before renewal")
    const receipt = await this.receipt(target, "renew")
    try {
      for (const status of statuses) {
        await receipt.append("pending-renew", [status.name])
        const renewed = await this.json(Renewed, "sandbox-db", ["renew", "--worktree", target.path, "--json", "--lease", status.name, "--ttl", ttl], signal)
        if (renewed.lease !== status.name) refuse("Renewal identity mismatch")
        await receipt.append("renewed", [status.name])
      }
      return { status: "renewed", receipt: await receipt.complete() }
    } finally { await receipt.close() }
  }

  async retire(cwd: string, target: Target, confirm: string, deleteBranch = false, signal?: AbortSignal, expectedReleases?: ReadonlyArray<string>, expectedPlan?: string) {
    if (confirm !== target.path) refuse("Explicit confirmation must equal the canonical target path")
    const initial = await this.retirement(cwd, target, signal)
    if (expectedReleases && JSON.stringify([...expectedReleases].sort()) !== JSON.stringify(initial.statuses.filter((s) => s.status !== "none").map((s) => s.name).sort())) refuse("Confirmed release plan changed")
    if (expectedPlan && expectedPlan !== fingerprint([target, initial.inventory.root, initial.selected.branch, initial.head, initial.statuses])) refuse('Confirmed identity plan changed')
    const snapshot = (state: typeof initial) => JSON.stringify([state.selected.branch, state.head, state.selected.leases, state.statuses])
    const receipt = await this.receipt(target, "retire")
    const released: string[] = []
    try {
      await receipt.append('repository', [initial.inventory.root, initial.selected.branch ?? '', initial.head])
      await receipt.append("release-plan", initial.statuses.filter((s) => s.status !== "none").map((s) => `${s.name}:${s.id}`))
      const fresh = await this.retirement(cwd, target, signal)
      if (snapshot(fresh) !== snapshot(initial)) refuse("Target/leases changed; inspect receipt")
      for (const lease of fresh.statuses.filter((s) => s.status !== "none")) {
        // Full fresh identity, Git, ALL-agent and remaining-lease checks before each deletion.
        const before = await this.retirement(cwd, target, signal)
        const expectedRemaining = fresh.selected.leases.filter((l) => !released.includes(l.name))
        if (before.head !== initial.head || before.selected.branch !== initial.selected.branch || JSON.stringify(before.selected.leases) !== JSON.stringify(expectedRemaining)) refuse("Lease/branch identity changed; inspect receipt")
        await receipt.append("pending-release", [lease.name, lease.id ?? 'unknown'])
        const output = await this.json(Released, "sandbox-db", ["release", "--worktree", target.path, "--json", "--lease", lease.name], signal)
        if (output.lease !== lease.name || output.branch_id !== lease.id) refuse("Release identity mismatch; inspect receipt")
        released.push(lease.name)
        await receipt.append("released", [lease.name, lease.id ?? 'unknown'])
      }
      await receipt.append("pending-remove")
      const final = await this.retirement(cwd, target, signal)
      if (final.head !== initial.head || final.selected.branch !== initial.selected.branch || final.selected.leases.length || final.statuses.some((s) => s.status !== "none")) refuse("Target changed or leases remain; preserve checkout")
      await this.command("herdr", ["worktree", "remove", "--workspace", target.workspace], signal)
      await receipt.append("removed-worktree-and-workspace")
      let branch = "kept"
      if (deleteBranch && initial.selected.branch) {
        await receipt.append("pending-branch-delete", [initial.selected.branch, initial.head])
        try {
          const currentHead = (await this.command('git', ['-C', initial.inventory.source, 'rev-parse', `refs/heads/${initial.selected.branch}`], signal)).stdout.trim()
          if (currentHead !== initial.head) refuse('Branch moved; preserve ref')
          await this.command("git", ["-C", initial.inventory.source, "branch", "-d", "--", initial.selected.branch], signal)
          branch = "deleted"
        } catch { branch = "retained (not safely deletable, including squash merges)" }
        await receipt.append("branch", [branch])
      }
      return { status: "retired", path: target.path, released, branch, receipt: await receipt.complete() }
    } finally { await receipt.close() }
  }
}
