import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { rpcLocation } from '../../shared/location.js';
import { verifyPane } from '../view.js';
import { fixture, root, request, location, deferred, waitFor, flush, startServer, startTui, callTool } from './helpers.js';

test('second TUI during consent revokes authority before any subprocess', async (t) => {
  const f = fixture(), permission = deferred(); let entered = false, calls = 0;
  f.tui.ui.dialog.confirm = async () => { entered = true; return permission.promise; };
  const server = await startServer(f);
  const stopTui = startTui(f, { intervalMs: 5, env: { HERDR_ENV: '1' }, run: async () => { calls++; return { code: 0 }; } });
  t.after(async () => { permission.resolve(false); await stopTui(); await server.stop(); });
  await flush();
  const pending = callTool(f, { branch: 'feat/task' });
  const rejected = assert.rejects(pending, /ambiguous/);
  await waitFor(() => entered);
  await Effect.runPromise(f.handlers.pulse({ clientID: 'another-client', rootID: root.id }, {}));
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
