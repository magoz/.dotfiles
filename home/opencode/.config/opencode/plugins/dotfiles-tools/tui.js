import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { bridgeDefinition, validate, outcome } from './schema.js';
import { runProcess } from './process.js';
import { buildArgs, executeWorktree, BASE_GUIDANCE, LINK_GUIDANCE } from './worktree.js';

function sameLocation(a, b) { return a?.directory === b?.directory && a?.workspaceID === b?.workspaceID; }
export function rpcLocation(location) {
  return { directory: location.directory, ...(location.workspaceID ? { workspace: location.workspaceID } : {}) };
}

function cancellable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Pane request cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function verifyPane(ctx, request, location, signal) {
  signal.throwIfAborted();
  const route = ctx.ui.router.current();
  if (route.type !== 'session' || route.sessionID !== request.sessionID || request.rootID !== request.sessionID) throw new Error('Source route changed or is not a root session');
  const root = await ctx.client.session.get({ sessionID: request.sessionID }, { signal });
  if (root.id !== request.sessionID || root.parentID || !sameLocation(root.location, location)) throw new Error('Root session/location mismatch');
  if (!path.isAbsolute(root.location.directory) || request.cwd !== path.resolve(root.location.directory, root.subpath ?? '.')) throw new Error('Source cwd mismatch');
  // Query the full family, not only the TUI cache (which may omit descendants).
  const active = await ctx.client.session.active({ signal });
  if (!active || typeof active !== 'object' || Array.isArray(active)) throw new Error('Invalid active session response');
  const pending = [request.rootID], seen = new Set(pending);
  for (let index = 0; index < pending.length; index++) {
    let cursor;
    do {
      const page = await ctx.client.session.list({ parentID: pending[index], limit: 100, ...(cursor ? { cursor } : {}) }, { signal });
      if (!Array.isArray(page.data) || !page.cursor) throw new Error('Invalid family response');
      for (const child of page.data) {
        if (seen.has(child.id)) throw new Error('Inconsistent family response');
        if (seen.size >= 256) throw new Error('Family too large to verify safely');
        seen.add(child.id); pending.push(child.id);
        if (Object.hasOwn(active, child.id)) throw new Error('Child session running');
        ctx.data.session.permission.invalidate(child.id);
        ctx.data.session.form.invalidate(child.id, child.location);
        ctx.data.session.pending.invalidate(child.id);
        await Promise.all([
          ctx.data.session.permission.sync(child.id), ctx.data.session.form.sync(child.id, child.location),
          ctx.data.session.pending.sync(child.id),
        ]);
        const permissions = ctx.data.session.permission.list(child.id);
        const forms = ctx.data.session.form.list(child.id, child.location);
        if (!permissions || !forms || permissions.length || forms.length || ctx.data.session.pending.list(child.id).length) throw new Error('Child session blocked or queued');
      }
      const next = page.cursor.next;
      if (next && next === cursor) throw new Error('Repeated family cursor');
      cursor = next;
    } while (cursor);
  }
  const latestActive = await ctx.client.session.active({ signal });
  if (!latestActive || typeof latestActive !== 'object' || Array.isArray(latestActive)) throw new Error('Invalid active session response');
  for (const id of seen) if (id !== request.rootID && Object.hasOwn(latestActive, id)) throw new Error('Child session started during verification');
  signal.throwIfAborted();
  const current = ctx.ui.router.current();
  if (current.type !== 'session' || current.sessionID !== request.sessionID) throw new Error('Source route changed');
}

export function confirmation(request) {
  if (request.kind === 'worktree') return [
    `Session: ${request.sessionID}`, `cwd: ${request.cwd}`,
    'Preflight: ' + JSON.stringify(['provision-env', '--repo', request.cwd, '--check-vercel-link', '--non-interactive']),
    'Allocate (30 minute timeout): ' + JSON.stringify(['worktree', ...buildArgs(request.input, request.cwd)]),
    'Setup commands: ' + JSON.stringify(request.input.setup ?? []),
    'This changes Git/Herdr/environment/database state. Source remains open; destination owns implementation. Allow this request once?',
  ].join('\n');
  return [
    `Session: ${request.sessionID}`, `cwd: ${request.cwd}`,
    'Shell argv: ' + JSON.stringify(['/bin/sh', '-c', request.input.command]),
    `intervalMs=${request.input.intervalMs}; timeoutMs=${request.input.timeoutMs}; runtimeMs=${request.input.runtimeMs}`,
    'Condition MUST be read-only/side-effect-free. Shell is not sandboxed. Output is discarded; server HERDR_* environment is stripped. Allow these repeated checks once?',
  ].join('\n');
}

export function setupTui(ctx, { run = runProcess, env = { ...process.env }, intervalMs = 1000 } = {}) {
  const clientID = randomUUID();
  const rpc = ctx.client.rpc(bridgeDefinition);
  const lifetime = new AbortController(), active = new Map(), tasks = new Set();
  let binding, ticking = false, disposed = false;
  const rpcOptions = (location) => ({ location: rpcLocation(location), signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(3000)]) });
  const release = async (old) => {
    for (const controller of active.values()) controller.abort();
    active.clear();
    if (old) { try { await rpc.release({ clientID, rootID: old.rootID }, { location: rpcLocation(old.location), signal: AbortSignal.timeout(3000) }); } catch { /* lease expiry also cancels */ } }
  };
  const handle = async (request, bound, controller) => {
    const signal = controller.signal;
    const verify = async () => {
      await cancellable(verifyPane(ctx, request, bound.location, signal), signal);
      const authority = validate(bridgeDefinition.methods.authorize.output, await rpc.authorize({
        clientID, rootID: bound.rootID, id: request.id,
      }, rpcOptions(bound.location)));
      if (!authority.authorized) throw new Error('Pane claim expired or revoked');
      signal.throwIfAborted();
    };
    let result;
    try {
      await verify();
      if (request.kind === 'worktree' && env.HERDR_ENV !== '1') throw new Error('Worktree requires this TUI inside Herdr');
      const allowed = await cancellable(ctx.ui.dialog.confirm({ title: 'dotfiles-tools permission', message: confirmation(request) }), signal);
      signal.throwIfAborted();
      if (allowed !== true) throw new Error('Permission declined');
      await verify();
      result = request.kind === 'worktree'
        ? await executeWorktree(request, { run, env, signal, verify })
        : { status: 'approved' };
    } catch (error) {
      result = { status: 'failed', reason: error instanceof Error ? error.message : 'Pane request failed; preserve resources' };
    }
    try {
      // An aborted/expired request is never revived by a late dialog response.
      if (signal.aborted || disposed) return;
      outcome(result);
      const ack = validate(bridgeDefinition.methods.complete.output, await rpc.complete({
        clientID, rootID: bound.rootID, id: request.id, outcome: result,
      }, rpcOptions(bound.location)));
      if (!ack.acknowledged) throw new Error('Reply not acknowledged; preserve source and inspect destination');
      if (result.status === 'ready') ctx.ui.toast.show({
        variant: 'success', message: 'Destination ready and owns the task. Do not continue implementation in source. Source retained: review result, then exit this source manually.', duration: 15000,
      });
    } catch {
      if (!disposed) ctx.ui.toast.show({ variant: 'warning', message: 'Handoff reply not confirmed. Source retained; inspect partial/destination resources before retrying.' });
    } finally { active.delete(request.id); }
  };
  const tick = async () => {
    if (disposed || ticking) return;
    ticking = true;
    try {
      const route = ctx.ui.router.current();
      const root = route.type === 'session' ? ctx.data.session.get(route.sessionID) : undefined;
      const next = root && !root.parentID && root.id === route.sessionID
        ? { rootID: root.id, location: root.location } : undefined;
      if (!next || binding?.rootID !== next.rootID || !sameLocation(binding?.location, next.location)) {
        const old = binding; binding = undefined; await release(old); binding = next;
      }
      if (!binding) return;
      const bound = binding;
      const reply = validate(bridgeDefinition.methods.pulse.output, await rpc.pulse({ clientID, rootID: bound.rootID }, rpcOptions(bound.location)));
      if (disposed) return;
      for (const [id, controller] of active) if (!reply.active.includes(id)) { controller.abort(); active.delete(id); }
      if (reply.request) {
        if (reply.request.rootID !== bound.rootID || reply.request.sessionID !== bound.rootID || active.has(reply.request.id)) throw new Error('Invalid claim');
        const controller = new AbortController(); active.set(reply.request.id, controller);
        const task = handle(reply.request, bound, controller);
        tasks.add(task);
        void task.finally(() => tasks.delete(task));
      }
    } catch {
      const old = binding; binding = undefined; await release(old);
    } finally { ticking = false; }
  };
  // Real native slash API; it submits a user request, never fabricates tool calls.
  ctx.keymap.layer(() => ({ commands: [{
    id: 'dotfiles.worktree', title: 'Create worktree', palette: true,
    slash: { name: 'worktree', arguments: true },
    run: async (input = '') => {
      const route = ctx.ui.router.current();
      if (route.type !== 'session') { ctx.ui.toast.show({ variant: 'warning', message: 'Open a root session first.' }); return; }
      const task = input.trim() || (await ctx.ui.dialog.prompt({ title: 'New worktree', description: 'Describe the work, or specify the exact branch and task' }))?.trim();
      if (!task) return;
      const current = ctx.ui.router.current();
      if (current.type !== 'session' || current.sessionID !== route.sessionID) return;
      try {
        await ctx.client.session.prompt({ sessionID: route.sessionID, text: [
          'The user explicitly requests a new worktree. Use create_worktree for the task below; infer a concise conventional branch or use an explicitly named branch. Ask before consequential ambiguity. Source will remain open.',
          BASE_GUIDANCE, LINK_GUIDANCE, `Task: ${task}`,
        ].join('\n'), delivery: 'queue', resume: true });
      } catch { ctx.ui.toast.show({ variant: 'error', message: 'Could not submit worktree request; no automatic retry.' }); }
    },
  }] }));
  const timer = setInterval(() => { void tick(); }, intervalMs);
  void tick();
  return async () => {
    disposed = true; clearInterval(timer); lifetime.abort();
    const old = binding; binding = undefined; await release(old);
    await Promise.allSettled([...tasks]); // Await process-group SIGKILL grace before TUI unload returns.
  };
}

export default { id: 'dotfiles-tools', setup: (ctx) => setupTui(ctx) };
