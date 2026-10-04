import { Bridge } from './bridge.js';
import { bridgeDefinition, worktreeInput, worktreeOutputSchema, validate, outcome } from './schema.js';
import { resolveInput, sessionDirectory, BASE_GUIDANCE, LINK_GUIDANCE } from './worktree.js';

export async function setupServer(ctx) {
  const bridge = new Bridge();
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
      }
    } catch { /* fail closed below, never leak event/network payloads */ }
    if (!lifetime.signal.aborted) {
      healthy = false;
      for (const token of operations) token.controller.abort();
      bridge.dispose();
    }
  })();
  const cleanup = async () => {
    healthy = false; lifetime.abort();
    for (const token of operations) token.controller.abort();
    bridge.dispose();
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
    }));
  } catch (error) { await cleanup(); throw error; }
  return cleanup;
}

// Plugin.define is an identity helper in V2. Structural values avoid bundling a
// second Effect/SDK runtime and work with plain JavaScript on the Promise host.
export default { id: 'dotfiles-tools', setup: (ctx) => setupServer(ctx) };
