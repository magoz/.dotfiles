import test from 'node:test';
import assert from 'node:assert/strict';
import { Bridge } from '../bridge.js';
import { setupServer } from '../server.js';
import { setupTui, rpcLocation, verifyPane } from '../tui.js';
import { fixture, root, request, location, deferred, waitFor, flush } from './helpers.js';

test('operation abort revokes its exact later-created bridge request', async (t) => {
  let now = 100;
  const bridge = new Bridge({ now: () => now }); t.after(() => bridge.dispose());
  bridge.pulse({ clientID: 'one', rootID: root.id });
  const controller = new AbortController(); now = 200;
  const pending = bridge.request(request, 10000, controller.signal);
  const rejected = assert.rejects(pending, /cancelled/);
  const claimed = bridge.pulse({ clientID: 'one', rootID: root.id }).request;
  controller.abort(); await rejected;
  assert.equal(bridge.authorize({ clientID: 'one', rootID: root.id, id: claimed.id }).authorized, false);
  assert.equal(bridge.pulse({ clientID: 'one', rootID: root.id }).request, null);
  await assert.rejects(bridge.request(request, 10000, controller.signal), /cancelled/);
});

test('second TUI during consent revokes authority before any subprocess', async (t) => {
  const f = fixture(), permission = deferred(); let entered = false, calls = 0;
  f.tui.ui.dialog.confirm = async () => { entered = true; return permission.promise; };
  const stopServer = await setupServer(f.server);
  const stopTui = setupTui(f.tui, { intervalMs: 5, env: { HERDR_ENV: '1' }, run: async () => { calls++; return { code: 0 }; } });
  t.after(async () => { permission.resolve(false); await stopTui(); await stopServer(); });
  await flush();
  const pending = f.tools.get('create_worktree').execute({ branch: 'feat/task' }, { sessionID: root.id });
  const rejected = assert.rejects(pending, /ambiguous/);
  await waitFor(() => entered);
  await f.handlers.pulse({ clientID: 'another-client', rootID: root.id });
  permission.resolve(true); await rejected; await flush(); await flush();
  assert.equal(calls, 0);
});

test('workspace RPC uses native workspace query key', () => {
  assert.deepEqual(rpcLocation({ directory: '/repo', workspaceID: 'workspace-1' }), { directory: '/repo', workspace: 'workspace-1' });
  assert.deepEqual(rpcLocation({ directory: '/repo' }), { directory: '/repo' });
});

test('authoritative running state overrides cached idle; blockers are invalidated', async () => {
  const f = fixture();
  f.tui.client.session.list = async ({ parentID }) => ({ data: parentID === root.id ? [{ ...root, id: 'child', parentID: root.id, time: { idle: 5, updated: 5 } }] : [], cursor: {} });
  f.tui.client.session.active = async () => ({ child: { type: 'running' } });
  await assert.rejects(verifyPane(f.tui, request, location, new AbortController().signal), /running/);
  f.tui.client.session.active = async () => ({});
  const invalidated = [];
  for (const name of ['permission', 'form', 'pending']) f.tui.data.session[name].invalidate = () => invalidated.push(name);
  await verifyPane(f.tui, request, location, new AbortController().signal);
  assert.deepEqual(invalidated, ['permission', 'form', 'pending']);
});
