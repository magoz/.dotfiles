import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInput, buildArgs, sessionDirectory, executeWorktree } from '../worktree.js';
import { validate, worktreeInput, destinationSchema, outcome } from '../schema.js';
import { verifyPane, confirmation } from '../tui.js';
import { request, destination, fixture, root, location } from './helpers.js';

test('same inferred branch and optional CLI argv behavior, explicit OpenCode/JSON', () => {
  assert.equal(resolveInput({ prompt: 'Please create a new worktree to fix the broken café' }).branch, 'fix/broken-cafe');
  assert.equal(resolveInput({ branch: '  exact/name  ', prompt: 'ignored' }).branch, 'exact/name');
  assert.throws(() => resolveInput({}));
  const input = { branch: 'feat/task', base: 'origin/main', path: '/checkout space', label: 'label', ttl: '7d', prompt: 'hello; no shell', setup: ['one', 'two'] };
  assert.deepEqual(buildArgs(input, '/repo'), ['create', '--agent', 'opencode', '--json', '--repo', '/repo', '--branch', 'feat/task', '--base', 'origin/main', '--path', '/checkout space', '--label', 'label', '--ttl', '7d', '--prompt', 'hello; no shell', '--setup', 'one', '--setup', 'two']);
  assert.ok(!buildArgs({ prompt: 'task' }, '/repo').includes('--base'));
});

test('strict runtime boundaries reject model repo, unknown fields, non-OpenCode/incomplete success', () => {
  for (const value of [{ repo: '/evil' }, { branch: 2 }, { setup: ['ok', null] }, { branch: 'x\0y' }]) assert.throws(() => validate(worktreeInput, value));
  for (const value of [{ ...destination, agentKind: 'pi' }, { ...destination, extra: true }, { branch: 'x' }]) assert.throws(() => validate(destinationSchema, value));
  assert.throws(() => outcome({ status: 'ready' }));
});

test('server resolves authoritative session cwd, location/subpath and root ownership', async () => {
  const f = fixture();
  assert.equal((await sessionDirectory(f.server, root.id, true)).cwd, '/repo');
  f.setSession({ ...root, subpath: 'app' });
  assert.equal((await sessionDirectory(f.server, root.id, true)).cwd, '/repo/app');
  for (const session of [{ ...root, parentID: 'parent' }, { ...root, subpath: '../escape' }, { ...root, location: { directory: '/other' } }, { ...root, subpath: '/absolute' }]) {
    f.setSession(session); await assert.rejects(sessionDirectory(f.server, root.id, true));
  }
});

function executor(run) {
  return { run, env: { HERDR_ENV: '1', HERDR_SOCKET: 'local-pane' }, signal: new AbortController().signal, async verify() {} };
}
test('preflight link-required is structured and allocation never runs', async () => {
  const calls = [];
  const link = { status: 'vercel_link_required', directory: '/repo/app', reason: 'missing link' };
  const result = await executeWorktree(request, executor(async (command, args, options) => {
    calls.push(command); assert.deepEqual(args, ['--repo', '/repo', '--check-vercel-link', '--non-interactive']);
    assert.equal(options.timeoutMs, 30000);
    return { code: 3, stdout: '', stderr: JSON.stringify(link) };
  }));
  assert.deepEqual(result, { status: 'vercel_link_required', link }); assert.deepEqual(calls, ['provision-env']);
});

test('unknown preflight failures stop without leaking output or allocating', async () => {
  for (const value of [{ code: 1, stderr: 'secret' }, { code: 3, stderr: 'secret' }, { code: 3, stderr: '{"status":"vercel_link_required"}' }]) {
    let calls = 0;
    await assert.rejects(executeWorktree(request, executor(async () => { calls++; return value; })), /Vercel preflight failed/);
    assert.equal(calls, 1);
  }
});

test('success validates exact CLI schema and retains source; failures preserve resources', async () => {
  for (const value of [destination, { ...destination, agentKind: 'pi' }, { ...destination, branch: 'wrong' }, 'not JSON secret']) {
    let calls = 0;
    const result = executeWorktree(request, executor(async (command, args, options) => {
      calls++;
      if (command === 'provision-env') return { code: 0 };
      assert.equal(options.capture, 'stdout'); assert.equal(options.env.HERDR_SOCKET, 'local-pane');
      return { code: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) };
    }));
    if (value === destination) assert.deepEqual(await result, { status: 'ready', destination, sourceRetained: true });
    else await assert.rejects(result, /preserve resources/);
    assert.equal(calls, 2);
  }
});

test('cancelled preflight and missing pane stop allocation', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(executeWorktree(request, { ...executor(async () => { calls++; controller.abort(); return { code: 0 }; }), signal: controller.signal }));
  assert.equal(calls, 1);
  await assert.rejects(executeWorktree(request, { ...executor(async () => assert.fail()), env: {} }), /Herdr/);
});

test('pane route/root/cwd and full family guard rejects running and blocked descendants', async () => {
  const f = fixture(), signal = new AbortController().signal;
  await verifyPane(f.tui, request, location, signal);
  f.setRoute({ type: 'session', sessionID: 'other' });
  await assert.rejects(verifyPane(f.tui, request, location, signal), /route/);
  f.setRoute({ type: 'session', sessionID: root.id });
  await assert.rejects(verifyPane(f.tui, { ...request, cwd: '/evil' }, location, signal), /cwd/);
  f.tui.client.session.list = async ({ parentID }) => ({ data: parentID === root.id ? [{ ...root, id: 'child', parentID: root.id }] : [], cursor: {} });
  f.tui.client.session.active = async () => ({ child: { type: 'running' } });
  await assert.rejects(verifyPane(f.tui, request, location, signal), /running/);
  f.tui.client.session.active = async () => ({});
  f.tui.client.session.list = async ({ parentID }) => ({ data: parentID === root.id ? [{ ...root, id: 'child', parentID: root.id, time: { updated: 2, idle: 2 } }] : [], cursor: {} });
  await verifyPane(f.tui, request, location, signal);
  f.tui.data.session.permission.list = () => [{ id: 'permission' }];
  await assert.rejects(verifyPane(f.tui, request, location, signal), /blocked/);
  f.tui.data.session.permission.list = () => [];
  f.tui.data.session.form.list = () => [{ id: 'form' }];
  await assert.rejects(verifyPane(f.tui, request, location, signal), /blocked/);
});

test('permission text includes exact setup/cwd and condition bounds', () => {
  assert.match(confirmation({ ...request, input: { ...request.input, setup: ['npm ci'] } }), /npm ci/);
  const text = confirmation({ ...request, kind: 'until', input: { command: 'test -f ready', intervalMs: 1000, timeoutMs: 500, runtimeMs: 10000 } });
  for (const part of ['/repo', 'test -f ready', '1000', '500', '10000', 'side-effect-free']) assert.ok(text.includes(part));
});
