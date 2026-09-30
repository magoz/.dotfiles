import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, ROUTE, createNotifier, fit, openURL, pageLines, scrollTop, selectableIDs, setupFleet } from './view.js';
import { parseSnapshot } from './fleet.js';
import { NOW, change, fakeFetch, fakeTimers, flush, wireRow, wireSnapshot } from './fixtures.js';

/** Solid universal runtime stand-in: plain nodes; function children are read at inspection time. */
function fakeRuntime() {
  return {
    createElement: (tag) => ({ tag, props: {}, children: [] }),
    setProp: (node, key, value) => { node.props[key] = value; return value; },
    effect: (fn) => fn(undefined),
    insert: (parent, child) => { parent.children.push(child); },
    createComponent: (Component, props) => Component(props),
    createSignal: (value) => [() => value, (next) => { value = typeof next === 'function' ? next(value) : next; }],
    useTerminalDimensions: () => () => ({ width: 100, height: 30 }),
  };
}
const flat = (child) => typeof child === 'function' ? flat(child()) : Array.isArray(child) ? child.flatMap(flat) : [child];
const text = (node) => {
  const children = flat(node);
  if (children.length !== 1) return children.map(text).join('');
  const [one] = children;
  if (one === null || one === undefined) return '';
  if (typeof one !== 'object') return String(one);
  const parts = one.children.flatMap(flat);
  return parts.map(text).join(one.tag === 'box' && one.props.flexDirection === 'column' ? '\n' : '');
};

const color = (name) => `#${name}`;
const theme = {
  text: { base: color('base'), muted: color('muted'), feedback: Object.fromEntries(['error', 'warning', 'success', 'info'].map((k) => [k, { base: color(k) }])) },
  background: { base: color('bg'), raised: { high: color('raised') } },
};

function fixture({ options = {}, rows = [wireRow('w', 'working'), wireRow('n', 'needs-you', { pending: { permissions: 1, forms: 0 } })] } = {}) {
  const net = fakeFetch(), timers = fakeTimers();
  net.setSnapshot(wireSnapshot(rows));
  const layers = [], slots = [], routes = [], navigations = [], toasts = [], notified = [];
  let route = { type: 'home' };
  const ctx = {
    options, theme,
    keymap: { layer: (fn) => layers.push(fn) },
    data: { session: { root: (id) => id } },
    attention: { notify: async (o) => { notified.push(o); return { ok: true }; } },
    ui: {
      dialog: { clear: () => {} },
      toast: { show: (o) => toasts.push(o) },
      slot: (claim) => { slots.push(claim); return () => { slots.splice(slots.indexOf(claim), 1); }; },
      router: {
        register: (page) => { routes.push(page); return () => routes.splice(routes.indexOf(page), 1); },
        navigate: (d) => { navigations.push(d); route = d; },
        current: () => route,
      },
    },
  };
  const opened = [];
  const dispose = setupFleet(ctx, fakeRuntime(), { fetch: net.fetch, timers, env: {}, now: () => NOW, openURL: async (u) => { opened.push(u); return true; } });
  const commands = () => layers.flatMap((fn) => fn().commands);
  const run = (bind) => commands().find((c) => c.bind?.split(',').includes(bind) || c.id === bind).run();
  const slot = (path) => slots.find((s) => s.append === path);
  return { ctx, net, timers, layers, slots, routes, navigations, toasts, notified, opened, dispose, commands, run, slot, setRoute: (r) => { route = r; } };
}

test('registers route, commands on free leader keys, badge on home and session footers only', async () => {
  const f = fixture();
  await flush();
  assert.deepEqual(f.routes.map((r) => r.name), [ROUTE]);
  f.slot('app').render();
  assert.deepEqual(f.commands().map((c) => [c.id, c.bind, c.slash?.name]), [['fleet.open', '<leader>f', 'fleet'], ['fleet.next', '<leader>j', undefined]]);
  assert.deepEqual(KEYS, { open: '<leader>f', next: '<leader>j' });
  assert.equal(text(f.slot('home.footer.status').render()), '⚑ 1 needs you · 1 working');
  assert.equal(text(f.slot('prompt.footer.status').render({ sessionID: undefined })), '');
  assert.equal(text(f.slot('prompt.footer.status').render({ sessionID: 's' })), '⚑ 1 needs you · 1 working');
  f.dispose();
});

test('page lists sections; j/k move; enter opens the session route; o opens the web link; esc returns', async () => {
  const f = fixture();
  await flush();
  f.slot('app').render();
  f.run('fleet.open');
  assert.deepEqual(f.navigations.at(-1), { type: 'plugin', name: ROUTE });
  const page = f.routes[0].render({});
  const screen = text(page);
  assert.match(screen, /^Fleet +connecting…/);
  assert.match(screen, /NEEDS YOU {2}1\n› box · T n +1 permission · 1m/);
  assert.match(screen, /WORKING {2}1\n {2}box · T w +working · 1m/);
  f.run('j');
  assert.match(text(page), / {2}box · T n[^\n]*\n\nWORKING {2}1\n› box · T w/);
  f.run('return');
  assert.deepEqual(f.navigations.at(-1), { type: 'session', sessionID: 'w' });
  f.setRoute({ type: 'plugin', name: ROUTE });
  f.run('k'); f.run('o');
  await flush();
  assert.deepEqual(f.opened, ['https://box.example/s']);
  f.run('escape');
  assert.deepEqual(f.navigations.at(-1), { type: 'home' });
  f.dispose();
});

test('next needs-you jumps to the session; toasts when nothing needs you', async () => {
  const f = fixture();
  await flush();
  f.slot('app').render();
  f.run('fleet.next');
  assert.deepEqual(f.navigations.at(-1), { type: 'session', sessionID: 'n' });
  const g = fixture({ rows: [wireRow('w', 'working')] });
  await flush();
  g.slot('app').render();
  g.run('fleet.next');
  assert.deepEqual(g.toasts.map((t) => t.message), ['Nothing needs you']);
  f.dispose(); g.dispose();
});

test('notifications: none for the first snapshot; gaps mode batches subagent needs-you; blurred only, no sound', async () => {
  const f = fixture({ rows: [wireRow('a', 'working'), wireRow('b', 'working')] });
  await flush();
  f.net.streams[0].send(change({ initial: true })); await flush();
  assert.equal(f.notified.length, 0);
  f.net.streams[0].send(change({ initial: false, rows: [wireRow('a', 'needs-you', { ownState: 'working' }), wireRow('b', 'needs-you')] }));
  await flush();
  assert.equal(f.notified.length, 0);
  await f.timers.run(1500);
  assert.deepEqual(f.notified, [{ title: 'Fleet', message: 'box · T a needs you', notification: { when: 'blurred' }, sound: false }]);
  f.dispose();
});

test('dispose stops timers and stream, removes contributions', async () => {
  const f = fixture();
  await flush();
  assert.equal(f.timers.intervals(), 1);
  f.dispose();
  await flush();
  assert.equal(f.timers.intervals(), 0);
  assert.deepEqual(f.timers.delays(), []);
  assert.equal(f.slots.length, 0);
  assert.equal(f.routes.length, 0);
});

test('page layout helpers: idle collapsed, truncation, scroll window, unreachable text', () => {
  const live = parseSnapshot(wireSnapshot([wireRow('i', 'idle'), wireRow('d', 'done', { title: 'x'.repeat(200) })]));
  const collapsed = pageLines({ live, status: 'live', baseURL: 'u', now: NOW, cols: 60, showIdle: false });
  assert.deepEqual(selectableIDs(collapsed), ['d']);
  assert.ok(collapsed.every((l) => l.parts.map((p) => p.text).join('').length <= 60));
  assert.match(collapsed.at(-1).parts.map((p) => p.text).join(''), /IDLE {2}1 {2}i to expand/);
  assert.deepEqual(selectableIDs(pageLines({ live, status: 'live', baseURL: 'u', now: NOW, cols: 60, showIdle: true })), ['d', 'i']);
  assert.equal(pageLines({ live: undefined, status: 'unreachable', baseURL: 'https://f', now: NOW, cols: 60 })[0].parts[0].text, 'Fleet unreachable at https://f');
  assert.equal(fit('abcdef', 4), 'abc…');
  assert.deepEqual([scrollTop(0, 3, 10, 5), scrollTop(0, 7, 10, 5), scrollTop(5, 2, 10, 5), scrollTop(3, 1, 4, 5)], [0, 3, 1, 0]);
});

test('notifier dedupes repeats within the quiet window', async () => {
  const timers = fakeTimers(), sent = [];
  let now = 0;
  const live = parseSnapshot(wireSnapshot([wireRow('a', 'needs-you')]));
  const notifier = createNotifier({ send: (m) => sent.push(m), live: () => live, timers, now: () => now });
  const t = [{ kind: 'needs-you', row: live.rows.get('a') }];
  notifier.push(t); await timers.run(1500);
  now = 10_000; notifier.push(t); await timers.run(1500);
  now = 61_000; notifier.push(t); await timers.run(1500);
  assert.equal(sent.length, 2);
});

test('openURL only spawns the OS opener for http(s) URLs', async () => {
  const spawned = [];
  const run = (command, args) => {
    spawned.push([command, ...args]);
    return { once: (event, fn) => { if (event === 'spawn') fn(); }, unref: () => {} };
  };
  assert.equal(await openURL('https://x.example/a', { platform: 'darwin', run }), true);
  assert.equal(await openURL('file:///etc/passwd', { platform: 'darwin', run }), false);
  assert.equal(await openURL('https://x.example', { platform: 'win32', run }), false);
  assert.deepEqual(spawned, [['open', 'https://x.example/a']]);
});
