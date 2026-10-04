import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import serverPlugin from '../server.ts';
import { fixture, root, destination, deferred, waitFor, flush, location, startServer, startTui, callTool } from './helpers.js';

test('Effect server and TUI exports; exact tool schema and permission contracts', async (t) => {
  assert.equal(serverPlugin.id, 'dotfiles-tools'); assert.equal(typeof serverPlugin.effect, 'function');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.exports['./server'], './server.ts'); assert.equal(pkg.exports['./tui'], './tui.js');
  const f = fixture(); const server = await startServer(f); t.after(server.stop);
  assert.deepEqual([...f.tools.keys()], ['create_worktree']);
  const tool = f.tools.get('create_worktree');
  assert.deepEqual(tool.options, { codemode: false, permission: 'create_worktree' });
  // The host validates tool input with this portable schema: a model-supplied repo is refused.
  const refused = await tool.input['~standard'].validate({ branch: 'feat/task', repo: '/evil' });
  assert.ok(refused.issues?.length);
  await assert.rejects(callTool(f, { branch: 'feat/task' }), /Exactly one/);
  await assert.rejects(callTool(f, { branch: 'feat/task' }, 'ses_child'), /root session/);
});

test('integrated pane-local CLI only, exact location RPC, native confirmation, source retained', async (t) => {
  const f = fixture(), calls = [];
  const server = await startServer(f);
  const stopTui = startTui(f, {
    env: { HERDR_ENV: '1', HERDR_SOCKET: 'LOCAL PANE' }, intervalMs: 5,
    run: async (command, args, options) => {
      calls.push(command); assert.equal(options.env.HERDR_SOCKET, 'LOCAL PANE');
      return command === 'provision-env' ? { code: 0 } : { code: 0, stdout: JSON.stringify(destination) };
    },
  });
  t.after(async () => { await stopTui(); await server.stop(); });
  await flush();
  const result = await callTool(f, { branch: 'feat/task' });
  assert.deepEqual(calls, ['provision-env', 'worktree']); assert.equal(f.confirmations, 1);
  assert.equal(result.output.sourceRetained, true); assert.equal(result.output.destination.agentKind, 'opencode');
  assert.match(result.content, /Destination owns the task/);
  await waitFor(() => f.toasts.length > 0);
  assert.match(f.toasts[0].message, /Source retained/);
  await f.tui.commands[0].run('exact task');
  assert.equal(f.prompts[0].sessionID, root.id); assert.equal(f.prompts[0].delivery, 'queue');
});

test('late permission after interruption cannot execute, a subsequent run is not poisoned', async (t) => {
  const f = fixture(), permission = deferred(); let calls = 0;
  f.tui.ui.dialog.confirm = async () => permission.promise;
  const server = await startServer(f);
  const stopTui = startTui(f, { intervalMs: 5, env: { HERDR_ENV: '1' }, run: async () => { calls++; return { code: 3, stderr: JSON.stringify({ status: 'vercel_link_required', directory: '/repo', reason: 'missing' }) }; } });
  t.after(async () => { permission.resolve(true); await stopTui(); await server.stop(); });
  await flush();
  const pending = callTool(f, { branch: 'feat/task' }), rejected = assert.rejects(pending);
  await flush(); await new Promise((resolve) => setTimeout(resolve, 20));
  f.emit({ type: 'session.execution.interrupted', created: Date.now(), data: { sessionID: root.id } });
  await rejected;
  await new Promise((resolve) => setTimeout(resolve, 20)); permission.resolve(true);
  await flush(); assert.equal(calls, 0);
  f.tui.ui.dialog.confirm = async () => true;
  const result = await callTool(f, { branch: 'feat/task' });
  assert.equal(result.output.status, 'vercel_link_required'); assert.deepEqual(result.output.retry, { branch: 'feat/task' }); assert.equal(calls, 1);
});

test('TUI disposal aborts pane requests and no late allocation; RPC location is session location', async () => {
  const f = fixture(), permission = deferred(); f.tui.ui.dialog.confirm = async () => permission.promise;
  const server = await startServer(f);
  const stopTui = startTui(f, { intervalMs: 5, env: { HERDR_ENV: '1' }, run: async () => assert.fail('late allocation') });
  try {
    await flush();
    const pending = callTool(f, { branch: 'feat/task' }), rejected = assert.rejects(pending);
    await flush(); await new Promise((resolve) => setTimeout(resolve, 20)); await stopTui(); await rejected;
    permission.resolve(true); await flush();
    assert.deepEqual(f.tui.location, location);
  } finally { await server.stop(); }
});
