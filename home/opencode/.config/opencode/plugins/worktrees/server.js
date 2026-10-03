import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runProcess, withoutPaneEnv } from '../dotfiles-tools/process.js';
import { branchFromName } from './naming.js';

export const STRATEGY_ID = 'dotfiles';

// Bounds. Provisioning (install + Vercel pull + two Neon branches) can take minutes.
const CREATE_TIMEOUT_MS = 30 * 60000;
const PLAN_TIMEOUT_MS = 5 * 60000;
const RETIRE_TIMEOUT_MS = 15 * 60000;
const GIT_TIMEOUT_MS = 30000;
// runProcess always waits this grace before a final group SIGKILL. The CLIs' own
// runner waits 2s before SIGKILLing descendants, so outlast it; plain git needs none.
const CLI_GRACE_MS = 3000;
const GIT_GRACE_MS = 250;
const MAX_OUTPUT = 65536;

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
// Reported values are echoed in errors: absolute, single-line, bounded, no URLs.
const isPath = (value) => typeof value === 'string' && value.length < 4096 && path.isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value) && !value.includes('://');
const isBranch = (value) => typeof value === 'string' && value.length > 0 && value.length < 256 && /^[A-Za-z0-9._/-]+$/.test(value);

function parseJson(stdout) {
  try { return JSON.parse(stdout.trim()); } catch { return undefined; }
}

// Exact `worktree checkout --json` success object.
function parseCheckout(stdout) {
  const value = parseJson(stdout);
  const keys = ['base', 'branch', 'path', 'source', 'warnings'];
  if (!isRecord(value) || Object.keys(value).sort().join() !== keys.join()) return undefined;
  if (!isPath(value.source) || !isPath(value.path) || !isBranch(value.branch) || typeof value.base !== 'string') return undefined;
  if (!Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === 'string' && warning.length < 1024)) return undefined;
  return value;
}

// `worktree checkout --json` failure report: stage + what exists, never free text.
function checkoutFailure(stdout, branch) {
  const report = parseJson(stdout);
  if (!isRecord(report) || report.status !== 'failed' || report.branch !== branch) {
    return `worktree checkout failed without a report for ${branch}; inspect for a partial checkout before retrying`;
  }
  if (report.stage === 'preflight' && report.checkout === 'none') {
    return `worktree checkout refused ${branch} before allocating anything (existing branch, invalid name, unreachable origin, missing base, or occupied destination); run \`worktree checkout\` manually for details`;
  }
  if (!isPath(report.path)) return `worktree checkout failed for ${branch}; inspect for a partial checkout before retrying`;
  if (report.stage === 'create' && report.checkout === 'unknown') {
    return `git worktree add failed for ${branch}; inspect ${report.path} and the branch before retrying`;
  }
  if ((report.stage === 'provision' || report.stage === 'setup') && report.checkout === 'preserved') {
    return `${report.stage} failed; preserved checkout ${report.path} on branch ${branch}. Inspect it; retire it with worktree-manage plan-checkout/retire-checkout`;
  }
  return `worktree checkout failed for ${branch}; inspect for a partial checkout before retrying`;
}

// worktree-manage captures its children's output and only prints sanitized
// ManagerError text ("worktree-manage: ..."); anything else is never echoed.
function managerReason(stderr) {
  const line = stderr.trim().split('\n').at(-1) ?? '';
  const match = /^worktree-manage: ([ -~]{1,300})$/.exec(line);
  return match && !match[1].includes('://') ? match[1] : 'unknown refusal';
}

function parseCommonDirectory(stdout) {
  const common = stdout.trim();
  if (!isPath(common) || path.basename(common) !== '.git') throw new Error('Only checkouts of a non-bare primary repository are supported');
  return path.dirname(common);
}

// Ownership marker written by `worktree checkout` into the linked worktree's PRIVATE
// git dir (`<common>/worktrees/<id>/dotfiles-worktree`); format and rules:
// home/scripts/.local/share/worktree/src/marker.ts. Found through the checkout's
// `.git` file (`gitdir: <path>`) so listing needs no subprocess per worktree.
export const MARKER_FILE = 'dotfiles-worktree';

/** The branch recorded in a checkout's ownership marker, or undefined if not owned. */
export function markedBranch(directory) {
  try {
    const link = path.join(directory, '.git');
    if (!lstatSync(link).isFile()) return undefined;
    const match = /^gitdir: (.+)$/.exec(readFileSync(link, 'utf8').trim());
    if (!match) return undefined;
    const gitDir = path.resolve(directory, match[1]);
    if (path.basename(path.dirname(gitDir)) !== 'worktrees') return undefined;
    const marker = JSON.parse(readFileSync(path.join(gitDir, MARKER_FILE), 'utf8'));
    return isRecord(marker) && marker.strategy === 'dotfiles' && isBranch(marker.branch) && typeof marker.createdAt === 'string'
      ? marker.branch : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse `git worktree list --porcelain -z`. The first record is the primary
 * checkout (root); bare and prunable records are skipped.
 */
export function parseWorktreeList(stdout) {
  const entries = [];
  let fields = [], index = 0;
  for (const field of stdout.split('\0')) {
    if (field !== '') { fields.push(field); continue; }
    if (fields.length === 0) continue;
    const directory = fields[0].startsWith('worktree ') ? fields[0].slice('worktree '.length) : undefined;
    if (!isPath(directory)) throw new Error('Unexpected git worktree list output');
    const skip = fields.some((item) => item === 'bare' || item === 'prunable' || item.startsWith('prunable '));
    const branch = fields.find((item) => item.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) ?? null;
    if (!skip) entries.push({ directory, type: index === 0 ? 'root' : 'worktree', branch });
    index += 1;
    fields = [];
  }
  if (fields.length > 0) throw new Error('Unexpected git worktree list output');
  return entries;
}

export function createStrategy({ run = runProcess, env = process.env } = {}) {
  // The plugin process's own environment (opencode.service), never Herdr pane identity.
  const childEnv = withoutPaneEnv(env);
  const exec = (command, args, { cwd, signal, timeoutMs, capture = 'stdout' }) =>
    run(command, args, {
      cwd, env: childEnv, signal, timeoutMs, capture, maxBytes: MAX_OUTPUT,
      cleanupGraceMs: command === 'git' ? GIT_GRACE_MS : CLI_GRACE_MS,
    });

  return {
    id: STRATEGY_ID,

    async create(input, { signal }) {
      if (!isRecord(input) || !isPath(input.sourceDirectory) || !isPath(input.directory)) throw new Error('Invalid worktree create input');
      if (input.branch !== undefined && (typeof input.branch !== 'string' || input.branch.trim() === '')) throw new Error('Invalid starting ref');
      // OpenCode's `name` is the suggested directory's last segment; its parent is ignored:
      // the CLI always places the checkout beside the primary repository.
      const branch = branchFromName(path.basename(input.directory));
      const args = ['checkout', '--json', '--repo', input.sourceDirectory, '--branch', branch];
      // OpenCode's `branch` is a starting ref, i.e. the CLI's explicit --base (no fetch).
      if (input.branch !== undefined) args.push('--base', input.branch.trim());
      const result = await exec('worktree', args, { cwd: input.sourceDirectory, signal, timeoutMs: CREATE_TIMEOUT_MS });
      if (result.code !== 0) throw new Error(checkoutFailure(result.stdout, branch));
      const created = parseCheckout(result.stdout);
      if (!created || created.branch !== branch) {
        throw new Error(`worktree checkout returned an invalid result for ${branch}; inspect for a checkout before retrying`);
      }
      for (const warning of created.warnings) console.warn(`[worktrees] ${created.path}: ${warning}`);
      return { directory: created.path };
    },

    async remove(input, { signal }) {
      if (!isRecord(input) || !isPath(input.directory)) throw new Error('Invalid worktree remove input');
      if (input.force !== false) {
        throw new Error('The dotfiles worktree strategy never force-removes. Commit, stash or clean the checkout, then delete it again.');
      }
      const directory = input.directory;
      if (markedBranch(directory) === undefined) {
        throw new Error(`${directory} is not a dotfiles worktree (no ownership marker); refusing to remove it. Retire Herdr/Pi worktrees with worktree-manage or /worktrees.`);
      }
      const common = await exec('git', ['-C', directory, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: directory, signal, timeoutMs: GIT_TIMEOUT_MS });
      if (common.code !== 0) throw new Error(`Not a Git checkout: ${directory}`);
      const primary = parseCommonDirectory(common.stdout);

      // Herdr-free retirement: plan, then retire with the exact plan token. No agent
      // checks: OpenCode/Fleet must not delete a worktree that still has working sessions.
      const plan = await exec('worktree-manage', ['plan-checkout', '--cwd', primary, '--path', directory], { cwd: primary, signal, timeoutMs: PLAN_TIMEOUT_MS, capture: 'both' });
      if (plan.code !== 0) throw new Error(`Retirement refused for ${directory}: ${managerReason(plan.stderr)}. Checkout preserved.`);
      const planned = parseJson(plan.stdout);
      if (!isRecord(planned) || planned.path !== directory || typeof planned.token !== 'string' || !/^[a-f0-9]{64}$/.test(planned.token)) {
        throw new Error(`Invalid retirement plan for ${directory}; checkout preserved`);
      }
      const retired = await exec('worktree-manage', [
        'retire-checkout', '--cwd', primary, '--path', directory, '--confirm', directory, '--expect-plan', planned.token,
      ], { cwd: primary, signal, timeoutMs: RETIRE_TIMEOUT_MS, capture: 'both' });
      if (retired.code !== 0) {
        throw new Error(`Retirement stopped for ${directory}: ${managerReason(retired.stderr)}. Inspect ~/.local/state/worktree-manager receipts before retrying.`);
      }
      const receipt = parseJson(retired.stdout);
      if (!isRecord(receipt) || receipt.status !== 'retired' || receipt.path !== directory) {
        throw new Error(`Unexpected retirement result for ${directory}; inspect ~/.local/state/worktree-manager receipts`);
      }
    },

    async list(sourceDirectory, { signal }) {
      if (!isPath(sourceDirectory)) throw new Error('Invalid source directory');
      const listed = await exec('git', ['-C', sourceDirectory, 'worktree', 'list', '--porcelain', '-z'], { cwd: sourceDirectory, signal, timeoutMs: GIT_TIMEOUT_MS });
      if (listed.code !== 0) throw new Error(`git worktree list failed for ${sourceDirectory}`);
      // Only marked checkouts on their recorded branch are `worktree` (owned by this
      // strategy). Everything else (primary, Herdr/Pi, plain `git worktree add`) is
      // reported as `root`: core stores it UNOWNED, so worktree.remove refuses it, and
      // since this strategy is consulted first the built-in `git` strategy never claims it.
      return parseWorktreeList(listed.stdout).map(({ directory, type, branch }) => ({
        directory,
        type: type === 'worktree' && branch !== null && markedBranch(directory) === branch ? 'worktree' : 'root',
      }));
    },
  };
}

export async function setupServer(ctx, options = {}) {
  const registration = await ctx.worktree.transform((editor) => editor.add(createStrategy(options)));
  return () => registration.dispose();
}

// Plugin.define is an identity helper in V2; a structural value needs no SDK at runtime.
export default { id: 'worktrees', setup: (ctx) => setupServer(ctx) };
