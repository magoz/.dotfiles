import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import serverPlugin, { setupServer } from '../server.js';
import tuiPlugin, { setupTui } from '../tui.js';
import { fixture, root, destination, deferred, waitFor, flush, location } from './helpers.js';

const toolContext = { sessionID: root.id, agent: 'build', messageID: 'msg_test', id: 'call_test', async progress() {} };

test('structural Promise and TUI exports, exact tool schema/permission contracts', async (t) => {
  assert.equal(serverPlugin.id, 'dotfiles-tools'); assert.equal(tuiPlugin.id, 'dotfiles-tools');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.exports['./server'], './server.js'); assert.equal(pkg.exports['./tui'], './tui.js');
  const f = fixture(); const cleanup = await setupServer(f.server); t.after(cleanup);
  assert.deepEqual([...f.tools.keys()], ['create_worktree', 'until']);
  assert.equal(f.tools.get('until').options.permission, 'shell');
  assert.equal(f.tools.get('until').input.type, 'object'); assert.ok(f.tools.get('until').output);
  await assert.rejects(f.tools.get('create_worktree').execute({ branch: 'feat/task' }, toolContext), /Exactly one/);
  await assert.rejects(f.tools.get('until').execute({ action: 'start', command: 'true' }, { ...toolContext, sessionID: 'child' }), /root session/);
});

test('integrated pane-local CLI only, exact location RPC, native confirmation, source retained', async (t) => {
  const f = fixture(), calls = [];
  const serverCleanup = await setupServer(f.server, { env: { HERDR_ENV: '1', HERDR_SOCKET: 'WRONG SERVER' }, run: async () => assert.fail('Server must never allocate') });
  const tuiCleanup = setupTui(f.tui, {
    env: { HERDR_ENV: '1', HERDR_SOCKET: 'LOCAL PANE' }, intervalMs: 5,
    run: async (command, args, options) => {
      calls.push(command); assert.equal(options.env.HERDR_SOCKET, 'LOCAL PANE');
      return command === 'provision-env' ? { code: 0 } : { code: 0, stdout: JSON.stringify(destination) };
    },
  });
  t.after(async () => { await tuiCleanup(); await serverCleanup(); });
  await flush();
  const result = await f.tools.get('create_worktree').execute({ branch: 'feat/task' }, toolContext);
  assert.deepEqual(calls, ['provision-env', 'worktree']); assert.equal(f.confirmations, 1);
  assert.equal(result.output.sourceRetained, true); assert.equal(result.output.destination.agentKind, 'opencode');
  await waitFor(() => f.toasts.length > 0);
  assert.match(f.toasts[0].message, /Source retained/);
  await f.tui.commands[0].run('exact task');
  assert.equal(f.prompts[0].sessionID, root.id); assert.equal(f.prompts[0].delivery, 'queue');
});

test('until confirmation precedes server process; only owner can manage and deletion cancels', async (t) => {
  const f = fixture(), permission = deferred(), processDone = deferred(); let options, called = 0;
  f.tui.ui.dialog.confirm = async () => permission.promise;
  const serverCleanup = await setupServer(f.server, {
    env: { HERDR_ENV: '1', HERDR_SOCKET: 'SERVER', PATH: '/bin' },
    run: async (_cmd, _args, value) => { called++; options = value; return processDone.promise; },
  });
  const tuiCleanup = setupTui(f.tui, { intervalMs: 5, env: {}, run: async () => assert.fail() });
  t.after(async () => { processDone.resolve({ code: 1 }); await tuiCleanup(); await serverCleanup(); });
  await flush();
  const pending = f.tools.get('until').execute({ action: 'start', command: 'test -f ready' }, toolContext);
  await flush(); assert.equal(called, 0);
  permission.resolve(true);
  const result = await pending;
  await waitFor(() => called === 1);
  assert.deepEqual(options.env, { PATH: '/bin' }); assert.equal(options.capture, 'none');
  await assert.rejects(f.tools.get('until').execute({ action: 'status', id: result.output.id }, { ...toolContext, sessionID: 'other' }), /Unknown/);
  f.stream.emit({ type: 'session.deleted', created: Date.now(), data: { sessionID: root.id } });
  await waitFor(() => options.signal.aborted);
  processDone.resolve({ code: 0 }); await flush(); assert.equal(f.synthetic.length, 0);
});

test('late permission after interruption cannot execute, a subsequent run is not poisoned', async (t) => {
  const f = fixture(), permission = deferred(); let calls = 0;
  f.tui.ui.dialog.confirm = async () => permission.promise;
  const serverCleanup = await setupServer(f.server);
  const tuiCleanup = setupTui(f.tui, { intervalMs: 5, env: { HERDR_ENV: '1' }, run: async () => { calls++; return { code: 3, stderr: JSON.stringify({ status: 'vercel_link_required', directory: '/repo', reason: 'missing' }) }; } });
  t.after(async () => { permission.resolve(true); await tuiCleanup(); await serverCleanup(); });
  await flush();
  const pending = f.tools.get('create_worktree').execute({ branch: 'feat/task' }, toolContext), rejected = assert.rejects(pending);
  await flush();
  const created = Date.now();
  f.stream.emit({ type: 'session.execution.interrupted', created, data: { sessionID: root.id } });
  await rejected;
  await new Promise((resolve) => setTimeout(resolve, 20)); permission.resolve(true);
  await flush(); assert.equal(calls, 0);
  f.tui.ui.dialog.confirm = async () => true;
  const result = await f.tools.get('create_worktree').execute({ branch: 'feat/task' }, toolContext);
  assert.equal(result.output.status, 'vercel_link_required'); assert.equal(calls, 1);
});

test('TUI disposal aborts pane requests and no late allocation; RPC location is session location', async () => {
  const f = fixture(), permission = deferred(); f.tui.ui.dialog.confirm = async () => permission.promise;
  const serverCleanup = await setupServer(f.server);
  const tuiCleanup = setupTui(f.tui, { intervalMs: 5, env: { HERDR_ENV: '1' }, run: async () => assert.fail('late allocation') });
  try {
    await flush();
    const pending = f.tools.get('create_worktree').execute({ branch: 'feat/task' }, toolContext), rejected = assert.rejects(pending);
    await flush(); await tuiCleanup(); await rejected;
    permission.resolve(true); await flush();
    assert.deepEqual(f.tui.location, location);
  } finally { await serverCleanup(); }
});
