import path from 'node:path';
import { destinationSchema, linkSchema, validate, worktreeInput } from './schema.js';

export const LINK_GUIDANCE = 'Investigate repository instructions, configured app directory, Git remote, and authenticated Vercel projects/teams. Verify connected repository and rootDirectory; never select by name alone. Link only an unambiguous existing project/team with explicit verified arguments. Keep .vercel ignored/untracked; do not follow symlinks, expose credentials, create a remote project, deploy, or change remote settings. Ask the user if selection or authentication is uncertain. Then retry identical create_worktree arguments; never blindly retry a failed allocation.';
export const BASE_GUIDANCE = 'Omit base for freshly fetched origin default-branch commit. Only specify base when explicitly requested or a freshly verified immutable SHA; never bypass a failed fetch with a local base.';

export function resolveInput(value) {
  validate(worktreeInput, value);
  let branch = value.branch?.trim();
  if (!branch && value.prompt?.trim()) {
    const task = value.prompt.trim();
    const prefix = /\b(fix|bug|broken|error|repair|regression)\b/i.test(task) ? 'fix' : 'feat';
    const slug = task.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/^(?:please\s+)?(?:create|start|make|open)\s+(?:a\s+)?(?:new\s+)?worktree\s+(?:to|for)\s+/i, '')
      .replace(/^(?:add|build|create|fix|implement|repair)\s+(?:a\s+|an\s+|the\s+)?/i, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52).replace(/-+$/g, '');
    if (slug) branch = `${prefix}/${slug}`;
  }
  if (!branch) throw new Error('Provide a branch or a kickoff prompt');
  return { ...value, branch };
}

export function buildArgs(input, cwd) {
  const resolved = resolveInput(input);
  const args = ['create', '--agent', 'opencode', '--json', '--repo', cwd, '--branch', resolved.branch];
  for (const name of ['base', 'path', 'label', 'ttl', 'prompt']) if (resolved[name]) args.push(`--${name}`, resolved[name]);
  for (const command of resolved.setup ?? []) args.push('--setup', command);
  return args;
}

export async function sessionDirectory(ctx, sessionID, rootOnly = false) {
  const session = await ctx.session.get({ sessionID });
  if (session.id !== sessionID || !session.location || !path.isAbsolute(session.location.directory)) throw new Error('Invalid session location');
  if (rootOnly && session.parentID) throw new Error('This operation requires the root session');
  if (session.location.directory !== ctx.location.directory || session.location.workspaceID !== ctx.location.workspaceID) {
    throw new Error('Session does not belong to this plugin location');
  }
  if (session.subpath !== undefined && (typeof session.subpath !== 'string' || path.isAbsolute(session.subpath))) throw new Error('Invalid session subpath');
  const cwd = path.resolve(session.location.directory, session.subpath ?? '.');
  const relative = path.relative(session.location.directory, cwd);
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('Session subpath escapes location');
  return { session, cwd };
}

export async function executeWorktree(request, { run, env, signal, verify }) {
  signal.throwIfAborted();
  if (env.HERDR_ENV !== '1') throw new Error('Worktree handoff requires this TUI inside Herdr');
  await verify();
  const preflight = await run('provision-env', [
    '--repo', request.cwd, '--check-vercel-link', '--non-interactive',
  ], { cwd: request.cwd, env, signal, timeoutMs: 30000, capture: 'both' });
  signal.throwIfAborted();
  if (preflight.code !== 0) {
    if (preflight.code === 3) {
      try {
        const link = validate(linkSchema, JSON.parse(preflight.stderr.trim()));
        if (!path.isAbsolute(link.directory)) throw new Error('Invalid link directory');
        return { status: 'vercel_link_required', link };
      } catch { /* Unknown preflight errors never authorize linking or allocation. */ }
    }
    throw new Error('Vercel preflight failed; no allocation attempted');
  }
  await verify();
  signal.throwIfAborted();
  const result = await run('worktree', buildArgs(request.input, request.cwd), {
    cwd: request.cwd, env, signal, timeoutMs: 30 * 60000, capture: 'stdout', cleanupGraceMs: 3000,
  });
  signal.throwIfAborted();
  if (result.code !== 0) throw new Error('Worktree failed; preserve and inspect partial resources before retrying');
  let destination;
  try { destination = validate(destinationSchema, JSON.parse(result.stdout.trim())); }
  catch { throw new Error('Invalid worktree success JSON; preserve resources and source'); }
  if (destination.branch !== request.input.branch || !path.isAbsolute(destination.path) || !path.isAbsolute(destination.source)) {
    throw new Error('Destination correlation failed; preserve resources and source');
  }
  return { status: 'ready', destination, sourceRetained: true };
}
