import path from 'node:path';
import { runProcess } from '../dotfiles-tools/process.js';

const object = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length > 0 && v.length < 4096 && !/[\x00-\x1f\x7f]/.test(v) && !v.includes('://');
const absolute = (v) => text(v) && path.isAbsolute(v);
const id = (v) => text(v) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v);
const lease = (v) => text(v) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v);
function invalid() { throw new Error('Invalid manager response'); }
export function inventory(value) {
  if (!object(value) || !absolute(value.source) || !absolute(value.root) || !Array.isArray(value.worktrees)) invalid();
  return value.worktrees.map((w) => {
    if (!object(w) || !absolute(w.path) || !(w.workspace === null || id(w.workspace)) ||
      typeof w.current !== 'boolean' || typeof w.linked !== 'boolean' || !['clean', 'dirty', 'unavailable'].includes(w.git) ||
      !Array.isArray(w.agents) || !Array.isArray(w.leases)) invalid();
    const agents = w.agents.map((a) => {
      if (!object(a) || !['pi', 'opencode', 'unknown'].includes(a.kind) || !['idle', 'done', 'working', 'blocked', 'unknown'].includes(a.status)) invalid();
      return `${a.kind}:${a.status}`;
    });
    const leases = w.leases.map((l) => { if (!object(l) || !lease(l.name)) invalid(); return l.name; });
    return { path: w.path, workspace: w.workspace, current: w.current, linked: w.linked, git: w.git, agents, leases };
  });
}
export function plan(value, target) {
  if (!object(value) || value.path !== target.path || value.workspace !== target.workspace ||
      !Array.isArray(value.releases) || !value.releases.every(lease) || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)) invalid();
  return { releases: value.releases, token: value.token };
}

// Native API verified against /tmp/opencode-v2-assessment/packages/plugin/src/tui/context.ts
// Only this pane executes CLI commands; no server hooks, RPC or broadcasts.
export function setupTui(ctx, { run = runProcess, env = { ...process.env } } = {}) {
  const lifetime = new AbortController();
  let active;
  const dialog = (promise) => new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Manager unloaded'));
    lifetime.signal.addEventListener('abort', abort, { once: true });
    if (lifetime.signal.aborted) abort();
    Promise.resolve(promise).then(resolve, reject).finally(() => lifetime.signal.removeEventListener('abort', abort));
  });
  const manage = async () => {
    if (active) return;
    const task = (async () => {
      if (env.HERDR_ENV !== '1') throw new Error('Run inside the intended Herdr pane');
      const route = ctx.ui.router.current();
      const session = route.type === 'session' ? ctx.data.session.get(route.sessionID) : undefined;
      if (!session || session.parentID || !absolute(session.location?.directory)) throw new Error('Open a local root session first');
      const cwd = path.resolve(session.location.directory, session.subpath ?? '.');
      const verify = () => {
        lifetime.signal.throwIfAborted();
        const current = ctx.ui.router.current();
        const root = current.type === 'session' ? ctx.data.session.get(current.sessionID) : undefined;
        if (current.type !== 'session' || current.sessionID !== route.sessionID || !root || root.parentID ||
            root.location.directory !== session.location.directory || root.location.workspaceID !== session.location.workspaceID ||
            path.resolve(root.location.directory, root.subpath ?? '.') !== cwd) throw new Error('Source route changed');
      };
      const call = async (args) => {
        verify();
        const result = await run('worktree-manage', [...args, '--cwd', cwd], {
          cwd, env, signal: lifetime.signal, timeoutMs: 5 * 60 * 1000, capture: 'stdout', maxBytes: 1024 * 1024, cleanupGraceMs: 3000,
        });
        if (result.code !== 0) throw new Error('Manager refused or failed; inspect local receipts, never blindly retry');
        try { return JSON.parse(result.stdout); } catch { return invalid(); }
      };
      const rows = inventory(await call(['list']));
      const selected = await dialog(ctx.ui.dialog.select({ title: 'Worktrees (Pi + OpenCode)', options: rows.map((w) => ({
        title: w.path, value: w.path,
        description: `${w.current ? 'CURRENT · ' : ''}${w.git} · ${w.agents.join(', ') || 'no agents'} · leases: ${w.leases.join(', ') || 'none'}`,
      })) }));
      if (!selected) return;
      const target = rows.find((w) => w.path === selected);
      if (!target?.workspace || !target.linked) throw new Error('No authoritative linked checkout/workspace');
      const action = await dialog(ctx.ui.dialog.select({ title: target.path, options: [
        { title: 'Renew databases (7d)', value: 'renew' },
        { title: 'Retire checkout + workspace (keep Git branch)', value: 'retire', disabled: target.current },
      ] }));
      if (action !== 'renew' && action !== 'retire') return;
      const args = ['--path', target.path, '--workspace', target.workspace];
      const confirmedPlan = action === 'retire' ? plan(await call(['plan', ...args]), target) : undefined;
      const releases = confirmedPlan?.releases ?? [];
      const allowed = await dialog(ctx.ui.dialog.confirm({ title: action === 'retire' ? 'Confirm retirement' : 'Confirm renewal', message: [
        `Target: ${target.path}`, `Workspace: ${target.workspace}`,
        action === 'retire' ? `Database releases: ${releases.join(', ') || 'none'}. Removes workspace and checkout; Git branch retained.`
          : `Renew all recorded leases (${target.leases.join(', ')}) plus default/test for 7d. No database releases.`,
        'Source remains open. Failures require manual receipt inspection; no automatic retry.',
      ].join('\n') }));
      if (allowed !== true) return;
      verify();
      const result = await call([action, ...args, ...(action === 'retire' ? ['--confirm', target.path, '--expect-releases', releases.join(','), '--expect-plan', confirmedPlan.token] : ['--ttl', '7d'])]);
      if (!object(result) || result.status !== (action === 'retire' ? 'retired' : 'renewed') || !absolute(result.receipt)) invalid();
      ctx.ui.toast.show({ variant: 'success', message: `${action} complete. Receipt: ${result.receipt}. Source retained.` });
    })();
    active = task;
    try { await task; }
    catch { ctx.ui.toast.show({ variant: 'warning', message: 'Worktree management stopped. Source retained. Inspect ~/.local/state/worktree-manager receipts before retrying; no raw command output shown.' }); }
    finally { active = undefined; }
  };
  ctx.keymap.layer(() => ({ commands: [{ id: 'dotfiles.worktrees', title: 'Manage worktrees', palette: true,
    slash: { name: 'worktrees' }, run: manage }] }));
  return async () => { lifetime.abort(); if (active) await Promise.allSettled([active]); };
}
export default { id: 'worktree-manager', setup: (ctx) => setupTui(ctx) };
