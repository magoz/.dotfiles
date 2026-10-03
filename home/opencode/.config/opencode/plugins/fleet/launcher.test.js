import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetApi } from './api.js';
import { parseSnapshot } from './fleet.js';
import { createLaunchWatch, routeKey, runLauncher } from './launcher.js';
import { fakeFetch, fakeTimers, payloads, wireLaunch, wireRow, wireSnapshot } from './fixtures.js';

const BASE = 'https://fleet.test';

/** A host whose dialogs answer from a script: `pick(options)` for select, then `prompts` in order. */
function host({ pick = () => undefined, prompts = [], route = { type: 'session', sessionID: 'here' } } = {}) {
  const dialogs = [], toasts = [], navigations = [];
  let current = route;
  const ctx = {
    ui: {
      dialog: {
        select: async (o) => { dialogs.push({ kind: 'select', ...o }); return pick(o.options); },
        prompt: async (o) => { dialogs.push({ kind: 'prompt', ...o }); return prompts.shift(); },
        clear: () => {},
      },
      toast: { show: (o) => toasts.push(o) },
      format: { path: (p) => p.replace('/home/magoz', '~') },
      router: { current: () => current, navigate: (d) => { navigations.push(d); current = d; } },
    },
  };
  return { ctx, dialogs, toasts, navigations, setRoute: (r) => { current = r; } };
}

function fleet() {
  const net = fakeFetch();
  net.respond('GET', '/api/fleet/launcher', 200, payloads.launcher);
  return { net, api: createFleetApi({ baseURL: BASE, fetch: net.fetch, timers: fakeTimers() }) };
}

const byTitle = (title) => (options) => options.find((o) => o.title === title)?.value;

test('open: picks a worktree, asks Fleet to open the checkout, lands in its session', async () => {
  const { net, api } = fleet();
  net.respond('POST', '/api/fleet/checkouts/open', 200, { sessionID: 'ses_new', created: true });
  const h = host({ pick: byTitle('fleet · feat/x') });
  const opened = [];
  await runLauncher({ ctx: h.ctx, api, openSession: (id) => opened.push(id), onLaunched: () => assert.fail('no launch') });
  const select = h.dialogs[0];
  assert.equal(select.title, 'Fleet: New / open');
  assert.equal(select.options[0].description, '~/dev/repos/fleet · 2 blocked · 2 finished · 2 working');
  assert.deepEqual(net.requests().map((r) => [r.method, r.path, r.body, r.headers.origin]), [
    ['GET', '/api/fleet/launcher', undefined, undefined],
    ['POST', '/api/fleet/checkouts/open', { directory: '/home/magoz/dev/repos/fleet-feat-x' }, BASE],
  ]);
  assert.deepEqual(opened, ['ses_new']);
  assert.deepEqual(h.toasts.map((t) => t.message), ['New session in fleet · feat/x']);
});

test('open falls back to the entry\'s latest session only when Fleet lacks the open route', async () => {
  const missing = fleet(), opened = [];
  await runLauncher({ ctx: host({ pick: byTitle('box') }).ctx, api: missing.api, openSession: (id) => opened.push(id) });
  assert.deepEqual(opened, ['ses_box']);
  const refused = fleet(), h = host({ pick: byTitle('anvil') });
  refused.net.respond('POST', '/api/fleet/checkouts/open', 400, { error: 'Not a git checkout on Box' });
  await runLauncher({ ctx: h.ctx, api: refused.api, openSession: (id) => opened.push(id) });
  assert.deepEqual(opened, ['ses_box']);
  assert.deepEqual(h.toasts.map((t) => [t.variant, t.message]), [['error', 'Could not open anvil: Not a git checkout on Box']]);
});

test('new worktree: task, then the suggested branch (editable), then POST /api/fleet/launches', async () => {
  const { net, api } = fleet();
  net.respond('POST', '/api/fleet/launcher/branch', 200, { branch: 'feat/dark-mode', source: 'model' });
  net.respond('POST', '/api/fleet/launches', 200, { launchID: 'launch-9' });
  const h = host({ pick: byTitle('+ New worktree in fleet…'), prompts: ['  Add dark mode ', 'feat/dark-theme'] });
  const launched = [];
  await runLauncher({ ctx: h.ctx, api, openSession: () => assert.fail('no open'), onLaunched: (l) => launched.push(l) });
  assert.deepEqual(h.dialogs.slice(1).map((d) => [d.title, d.value]), [['New worktree in fleet', undefined], ['Branch in fleet', 'feat/dark-mode']]);
  assert.match(h.dialogs[2].description, /^Suggested/);
  assert.deepEqual(net.requests().slice(1).map((r) => [r.path, r.body, r.headers.origin, r.headers['content-type']]), [
    ['/api/fleet/launcher/branch', { task: 'Add dark mode' }, BASE, 'application/json'],
    ['/api/fleet/launches', { repoDir: '/home/magoz/dev/repos/fleet', branch: 'feat/dark-theme', task: 'Add dark mode' }, BASE, 'application/json'],
  ]);
  assert.deepEqual(launched, [{ launchID: 'launch-9', branch: 'feat/dark-theme', repoName: 'fleet' }]);
  assert.deepEqual(h.toasts.map((t) => t.message), ['Suggesting a branch…', 'Provisioning feat/dark-theme in fleet…']);
});

test('new worktree: cancelling stops early; no suggestion leaves the branch to type; launch errors toast', async () => {
  const cancel = fleet();
  await runLauncher({ ctx: host({ pick: byTitle('+ New worktree in box…'), prompts: [undefined] }).ctx, api: cancel.api, openSession: () => {} });
  assert.equal(cancel.net.requests().length, 1);
  const fail = fleet();
  fail.net.respond('POST', '/api/fleet/launches', 400, { error: 'Invalid input' });
  const h = host({ pick: byTitle('+ New worktree in box…'), prompts: ['Task', 'bad branch'] });
  await runLauncher({ ctx: h.ctx, api: fail.api, openSession: () => {}, onLaunched: () => assert.fail('no launch') });
  assert.equal(h.dialogs[2].value, '');
  assert.match(h.dialogs[2].description, /^No suggestion \(Fleet answered 404\)/);
  assert.deepEqual(h.toasts.at(-1), { variant: 'error', message: 'Could not launch bad branch: Invalid input' });
  const none = fleet(), g = host();
  await runLauncher({ ctx: g.ctx, api: none.api, openSession: () => {} });
  assert.equal(none.net.requests().length, 1);
  const down = fleet(), d = host();
  down.net.setDown(true);
  await runLauncher({ ctx: d.ctx, api: down.api, openSession: () => {} });
  assert.deepEqual(d.toasts.map((t) => t.message), ['Fleet launcher unavailable: Fleet is not reachable']);
});

test('ready launch: navigates only if the user has not navigated since; else a toast offers it', () => {
  const live = (launch) => parseSnapshot(wireSnapshot([wireRow('w', 'working')], 'connected', launch ? [launch] : []));
  const h = host(), opened = [];
  const watch = createLaunchWatch({ ctx: h.ctx, openSession: (id) => opened.push(id) });
  watch.start({ launchID: 'launch-1' });
  watch.check(live(undefined));
  assert.equal(watch.size, 1);
  watch.check(live(wireLaunch({ status: 'creating-session' })));
  watch.check(live(wireLaunch({ status: 'ready', sessionID: 'ses_ready' })));
  assert.deepEqual(opened, ['ses_ready']);
  assert.equal(watch.size, 0);

  watch.start({ launchID: 'launch-1' });
  h.setRoute({ type: 'session', sessionID: 'elsewhere' });
  watch.check(live(wireLaunch({ status: 'ready', sessionID: 'ses_ready' })));
  assert.deepEqual(opened, ['ses_ready']);
  assert.deepEqual(h.toasts.at(-1), { variant: 'success', message: 'feat/palette is ready', sessionID: 'ses_ready' });

  watch.start({ launchID: 'launch-1' });
  watch.check(live(wireLaunch({ status: 'failed', error: 'No exact worktree name for feat/palette' })));
  assert.deepEqual(h.toasts.at(-1), { variant: 'error', message: 'Launch of feat/palette failed: No exact worktree name for feat/palette' });
  watch.start({ launchID: 'launch-1' });
  watch.check(live(wireLaunch()));
  watch.check(live(undefined));
  assert.equal(watch.size, 0);
  assert.deepEqual([routeKey({ type: 'home' }), routeKey({ type: 'plugin', name: 'fleet', id: 'x' })], ['home', 'plugin:fleet']);
});
