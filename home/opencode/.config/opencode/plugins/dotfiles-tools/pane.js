// Pane-local allocation (TUI side, plain JS): runs `provision-env` then `worktree create` with
// THIS TUI's environment (its Herdr pane), never the server's. Unknown failures stop and
// preserve resources; CLI output is decoded exactly and never echoed.
import path from 'node:path';
import { decodeDestination, decodeLink } from './contract.ts';
import { buildArgs } from './worktree.ts';

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
        const link = decodeLink(JSON.parse(preflight.stderr.trim()));
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
  try { destination = decodeDestination(JSON.parse(result.stdout.trim())); }
  catch { throw new Error('Invalid worktree success JSON; preserve resources and source'); }
  if (destination.branch !== request.input.branch || !path.isAbsolute(destination.path) || !path.isAbsolute(destination.source)) {
    throw new Error('Destination correlation failed; preserve resources and source');
  }
  return { status: 'ready', destination, sourceRetained: true };
}
