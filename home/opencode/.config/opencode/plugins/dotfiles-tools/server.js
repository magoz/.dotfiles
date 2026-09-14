import { Bridge } from './bridge.js';
import { UntilJobs, untilOptions } from './until.js';
import { runProcess, withoutPaneEnv } from './process.js';
import { bridgeDefinition, worktreeInput, untilInput, worktreeOutputSchema, untilOutputSchema, validate, outcome } from './schema.js';
import { resolveInput, sessionDirectory, BASE_GUIDANCE, LINK_GUIDANCE } from './worktree.js';

export async function setupServer(ctx, { run = runProcess, env = process.env } = {}) {
  const bridge = new Bridge();
  const jobs = new UntilJobs({ run, synthetic: (input, options) => ctx.session.synthetic(input, options), env: withoutPaneEnv(env) });
  const lifetime = new AbortController(), operations = new Set(), registrations = [];
  let healthy = true;
  const operation = async (sessionID, execute) => {
    if (!healthy) throw new Error('Plugin event stream unavailable; reload before retrying');
    const token = { sessionID, created: Date.now(), controller: new AbortController() };
    operations.add(token);
    try { return await execute(token.controller.signal); } finally { operations.delete(token); }
  };
  const events = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: lifetime.signal })) {
        if (!['session.deleted', 'session.execution.interrupted'].includes(event.type)) continue;
        const sessionID = event.data.sessionID;
        if (typeof sessionID !== 'string' || !Number.isFinite(event.created)) continue;
        const created = event.type === 'session.deleted' ? Infinity : event.created;
        for (const token of operations) if (token.sessionID === sessionID && token.created <= created) token.controller.abort();
        bridge.cancelSession(sessionID, created);
        if (event.type === 'session.deleted') jobs.deleteSession(sessionID);
        else jobs.cancelSession(sessionID, created);
      }
    } catch { /* fail closed below, never leak event/network payloads */ }
    if (!lifetime.signal.aborted) {
      healthy = false;
      for (const token of operations) token.controller.abort();
      bridge.dispose(); jobs.dispose();
    }
  })();
  const cleanup = async () => {
    healthy = false; lifetime.abort();
    for (const token of operations) token.controller.abort();
    bridge.dispose(); await jobs.dispose();
    for (const registration of registrations.reverse()) await registration.dispose();
    await events;
  };
  try {
    registrations.push(await ctx.rpc.register(bridgeDefinition, {
      pulse: async (input) => {
        validate(bridgeDefinition.methods.pulse.input, input);
        await sessionDirectory(ctx, input.rootID, true);
        return bridge.pulse(input);
      },
      authorize: async (input) => bridge.authorize(input),
      complete: async (input) => bridge.complete(input),
      release: async (input) => bridge.release(input),
    }));
    registrations.push(await ctx.tool.transform((tools) => {
      tools.add({
        name: 'create_worktree', input: worktreeInput, output: worktreeOutputSchema,
        options: { codemode: false, permission: 'create_worktree' },
        description: 'Only when the user explicitly asks: create/provision a Herdr worktree and fresh OpenCode destination. Requires root session and a unique pane-local TUI confirmation. Source remains open. ' + BASE_GUIDANCE + ' ' + LINK_GUIDANCE,
        execute: async (input, tool) => operation(tool.sessionID, async (signal) => {
          const resolved = resolveInput(input);
          const { cwd } = await sessionDirectory(ctx, tool.sessionID, true);
          signal.throwIfAborted();
          const result = outcome(await bridge.request({
            sessionID: tool.sessionID, rootID: tool.sessionID, cwd, kind: 'worktree', input: resolved,
          }, 32 * 60000, signal));
          signal.throwIfAborted();
          if (result.status === 'failed') throw new Error(result.reason);
          const output = validate(worktreeOutputSchema, result.status === 'vercel_link_required' ? { ...result, retry: resolved } : result);
          return {
            output,
            content: JSON.stringify(output) + (result.status === 'vercel_link_required' ? '\n' + LINK_GUIDANCE : '\nDestination owns the task. Do not continue implementation in the source. Source retained explicitly: review destination, then manually exit only this source TUI. Do not retry a successful allocation.'),
          };
        }),
      });
      tools.add({
        name: 'until', input: untilInput, output: untilOutputSchema, options: { codemode: false, permission: 'shell' },
        description: 'Start/list/status/cancel session-owned bounded, read-only shell-condition checks. start requires unique root TUI and an explicit native permission confirmation of command/cwd/bounds. Never use mutating commands or secret output. Output is discarded; one queued synthetic resume on success. Defaults: 5s interval, 10s check timeout, 1h runtime; max runtime 24h. Conditions must be side-effect-free by contract, not sandboxed.',
        execute: async (input, tool) => {
          validate(untilInput, input);
          if (input.action !== 'start') {
            if (Object.keys(input).some((key) => !['action', 'id'].includes(key))) throw new Error('Only action/id accepted for management');
            let output;
            if (input.action === 'list') {
              if (input.id !== undefined) throw new Error('list does not accept id');
              output = jobs.list(tool.sessionID);
            } else {
              if (!input.id) throw new Error('status/cancel requires id');
              output = input.action === 'cancel' ? jobs.cancel(tool.sessionID, input.id) : jobs.view(jobs.owned(tool.sessionID, input.id));
            }
            validate(untilOutputSchema, output);
            return { output, content: JSON.stringify(output) };
          }
          return operation(tool.sessionID, async (signal) => {
            const options = untilOptions(input);
            const { cwd } = await sessionDirectory(ctx, tool.sessionID, true);
            signal.throwIfAborted();
            const result = outcome(await bridge.request({
              sessionID: tool.sessionID, rootID: tool.sessionID, cwd, kind: 'until', input: options,
            }, 120000, signal));
            signal.throwIfAborted();
            if (result.status !== 'approved') throw new Error('until permission declined or expired');
            const output = validate(untilOutputSchema, jobs.start(tool.sessionID, cwd, options));
            return { output, content: JSON.stringify(output) };
          });
        },
      });
    }));
  } catch (error) { await cleanup(); throw error; }
  return cleanup;
}

// Plugin.define is an identity helper in V2. Structural values avoid bundling a
// second Effect/SDK runtime and work with plain JavaScript on the Promise host.
export default { id: 'dotfiles-tools', setup: (ctx) => setupServer(ctx) };
