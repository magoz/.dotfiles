import { expect, test } from 'bun:test';
import { inventory, setupTui } from './tui.js';

function fixture({ allowed = true } = {}) {
  let commands, route = { type: 'session', sessionID: 'source' };
  const calls = [], confirmations = [], toasts = [];
  const row = { path: '/repo-target', workspace: 'target-ws', current: false, linked: true, git: 'clean',
    agents: [{ kind: 'pi', status: 'idle' }, { kind: 'opencode', status: 'done' }], leases: [{ name: 'test' }, { name: 'default' }] };
  const answers = ['/repo-target', 'retire'];
  const ctx = {
    keymap: { layer: (fn) => { commands = fn().commands; } },
    ui: { router: { current: () => route }, dialog: {
      select: async () => answers.shift(),
      confirm: async (options) => { confirmations.push(options); return allowed; },
    }, toast: { show: (options) => { toasts.push(options); } } },
    data: { session: { get: () => ({ id: 'source', location: { directory: '/repo-source', workspaceID: 'source-ws' } }) } },
  };
  const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'pane-local', PATH: '/local/bin' };
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    return { code: 0, stdout: JSON.stringify(args[0] === 'list'
      ? { source: '/repo-source', root: '/repo-source', worktrees: [row] }
      : args[0] === 'plan' ? { path: row.path, workspace: row.workspace, releases: ['test', 'default'], token: 'a'.repeat(64) }
        : { status: 'retired', receipt: '/private/receipt.complete.jsonl' }) };
  };
  const dispose = setupTui(ctx, { run, env });
  const start = () => commands[0].run();
  return { ctx, calls, confirmations, toasts, env, start, dispose, setRoute: (v) => { route = v; } };
}
test('native /worktrees confirms target/releases and runs CLI in pane env, no server calls', async () => {
  const f = fixture(); await f.start(); await f.dispose();
  expect(f.calls.map((c) => c.args[0])).toEqual(['list', 'plan', 'retire']);
  expect(f.confirmations[0].message).toContain('Target: /repo-target');
  expect(f.confirmations[0].message).toContain('Database releases: test, default');
  expect(f.calls[2].args).toContain('--confirm'); expect(f.calls[2].args).toContain('--expect-releases');
  expect(f.calls.every((c) => c.options.env === f.env && c.options.cwd === '/repo-source')).toBe(true);
  expect(f.calls[2].options.cleanupGraceMs).toBe(3000);
  expect(f.toasts[0].message).toContain('Source retained');
});
test('declined confirmation never mutates', async () => {
  const f = fixture({ allowed: false }); await f.start(); await f.dispose();
  expect(f.calls.map((c) => c.args[0])).toEqual(['list', 'plan']);
});
test('source route change after confirmation prevents mutation', async () => {
  const f = fixture(); f.ctx.ui.dialog.confirm = async () => { f.setRoute({ type: 'home' }); return true; };
  await f.start(); await f.dispose();
  expect(f.calls.map((c) => c.args[0])).toEqual(['list', 'plan']);
});
test('unload while dialog open cancels without waiting for dialog or launching mutation', async () => {
  const f = fixture(); f.ctx.ui.dialog.select = () => new Promise(() => {});
  const task = f.start(); await Bun.sleep(5); await f.dispose(); await task;
  expect(f.calls).toHaveLength(1);
});
test('unknown inventory shape fails closed without echoing payload', () => {
  expect(() => inventory({ secret: 'https://TOKEN.invalid' })).toThrow('Invalid manager response');
});
