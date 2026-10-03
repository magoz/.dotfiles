import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE, SIDEBAR_COLS, createNotifier, fit, openURL, pageLines, scrollTop, selectableIDs, setupFleet, sidebarLines } from './view.js';
import { parseSnapshot } from './fleet.js';
import { NOW, change, fakeFetch, fakeTimers, flush, payloads, wireLaunch, wireRow, wireSnapshot } from './fixtures.js';

const ORIGIN = 'https://fleet.oox.sh';

/** Solid universal runtime stand-in: plain nodes; function children are read at inspection time. */
function fakeRuntime() {
  return {
    createElement: (tag) => ({ tag, props: {}, children: [] }),
    setProp: (node, key, value) => { node.props[key] = value; return value; },
    effect: (fn) => fn(undefined),
    insert: (parent, child) => { parent.children.push(child); },
    createComponent: (Component, props) => Component(props),
    createSignal: (value) => [() => value, (next) => { value = typeof next === 'function' ? next(value) : next; }],
    useTerminalDimensions: () => () => ({ width: 100, height: 40 }),
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
/** The sidebar's line boxes: `{ text, selected, click }`. */
const sidebarBoxes = (node) => flat(node)[0].children.flatMap(flat).map((box) => ({
  text: text(box).trimEnd(), selected: box.props.backgroundColor === '#raised', click: box.props.onMouseUp,
}));

const color = (name) => `#${name}`;
const theme = {
  text: { base: color('base'), muted: color('muted'), feedback: Object.fromEntries(['error', 'warning', 'success', 'info'].map((k) => [k, { base: color(k) }])) },
  background: { base: color('bg'), raised: { high: color('raised') } },
};

function fixture({ options = {}, snapshot = payloads.snapshot, route: initial = { type: 'home' }, pick, prompts = [] } = {}) {
  const net = fakeFetch(), timers = fakeTimers();
  net.setSnapshot(snapshot);
  const layers = [], slots = [], routes = [], navigations = [], toasts = [], notified = [], dialogs = [];
  let route = initial;
  const ctx = {
    options, theme,
    keymap: { layer: (fn) => layers.push(fn) },
    data: { session: { root: (id) => (id.endsWith('_child') ? id.slice(0, -'_child'.length) : id) } },
    attention: { notify: async (o) => { notified.push(o); return { ok: true }; } },
    ui: {
      dialog: {
        clear: () => {},
        select: async (o) => { dialogs.push(o); return pick?.(o.options); },
        prompt: async (o) => { dialogs.push(o); return prompts.shift(); },
      },
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
  const run = (bind) => commands().find((c) => c.bind?.split?.(',').includes(bind) || c.id === bind).run();
  const slot = (kind, path) => slots.find((s) => s[kind] === path);
  const sidebar = (sessionID = 'ses_x') => slot('replace', 'sidebar.content').render({ sessionID });
  return { ctx, net, timers, layers, slots, routes, navigations, toasts, notified, opened, dialogs, dispose, commands, run, slot, sidebar, setRoute: (r) => { route = r; } };
}

test('registers the sidebar replacement, page, footer badges and leader commands on free keys', async () => {
  const f = fixture();
  await flush();
  assert.deepEqual(f.routes.map((r) => r.name), [ROUTE]);
  assert.deepEqual(f.slots.map((s) => Object.entries(s).find(([k]) => k !== 'render')), [
    ['append', 'app'], ['replace', 'sidebar.content'], ['append', 'home.footer.status'], ['append', 'prompt.footer.status'],
  ]);
  f.slot('append', 'app').render();
  assert.deepEqual(f.commands().map((c) => [c.id, c.title, c.bind, c.palette]), [
    ['fleet.open', 'Fleet', '<leader>f', true],
    ['fleet.next', 'Fleet: Next needs-me session', '<leader>j', true],
    ['fleet.launcher', 'Fleet: New / open', '<leader>o', true],
    ['fleet.handled', 'Fleet: Mark handled', '<leader>h', true],
    ['fleet.undo', 'Fleet: Undo handled', '<leader>z', true],
  ]);
  assert.equal(f.layers[0]().mode, 'global');
  assert.equal(text(f.slot('append', 'home.footer.status').render()), '⚑ 7 need you · 3 working · 2 stuck');
  assert.equal(text(f.slot('append', 'prompt.footer.status').render({ sessionID: undefined })), '');
  assert.equal(text(f.slot('append', 'prompt.footer.status').render({ sessionID: 's' })), '⚑ 7 need you · 3 working · 2 stuck');
  f.dispose();
  const g = fixture({ options: { keys: { launcher: '<leader>p', undo: false } } });
  g.slot('append', 'app').render();
  assert.deepEqual(g.commands().map((c) => c.bind), ['<leader>f', '<leader>j', '<leader>p', '<leader>h', false]);
  g.dispose();
});

test('sidebar: launches above the needs-me list, current session highlighted, reasons, counts and key hints', async () => {
  const f = fixture();
  assert.match(text(f.sidebar()), /^Fleet\n\nConnecting to Fleet…\nhttps:\/\/fleet\.oox\.sh$/);
  await flush();
  f.net.streams[0].send(change({ initial: true })); await flush();
  const boxes = sidebarBoxes(f.sidebar('ses_wait_sub_child'));
  assert.deepEqual(boxes.map((b) => b.text), [
    'Fleet',
    '',
    'LAUNCHES  3',
    '◌ feat/palette · fleet           0:42',
    '  provisioning…',
    '  Add the launcher palette',
    '✕ fix/broken · fleet             0:32',
    '  failed: No exact worktree name for…',
    '  kept: nothing',
    '  × dismiss',
    '■ feat/x · fleet                 0:37',
    '  ready · open session',
    '  × dismiss',
    '',
    'BLOCKED  3',
    '■ fleet                            3h',
    '  Wait old',
    '  bash: pnpm db:push',
    '■ fleet · fleet-feat-x             1h',
    '  Wait new',
    '  Ship it?',
    '■ fleet                           50m',
    '  Wait on subagent',
    '  explore asks: Which database?',
    '',
    'FINISHED  4',
    '▪ fleet                            5h',
    '  Done old',
    '  run failed',
    '▪ fleet                            2h',
    '  Stopped run',
    '  stopped by OpenCode',
    '▪ fleet · fleet-feat-x            30m',
    '  Done new',
    '▪ scratch                         10m',
    '  Scratch',
    '',
    '3 working · 2 stuck',
    '',
    'ctrl+x j next · ctrl+x h handled',
    'ctrl+x z undo · ctrl+x o new',
  ]);
  assert.ok(boxes.every((b) => [...b.text].length <= SIDEBAR_COLS));
  assert.deepEqual(boxes.filter((b) => b.selected).map((b) => b.text), ['■ fleet                           50m', '  Wait on subagent', '  explore asks: Which database?']);
  boxes.find((b) => b.text === '  Wait old').click();
  boxes.find((b) => b.text === '  ready · open session').click();
  assert.deepEqual(f.navigations, [{ type: 'session', sessionID: 'ses_wait_old' }, { type: 'session', sessionID: 'ses_busy' }]);
  f.net.respond('POST', '/api/fleet/launches/launch-2/dismiss', 200, { launchID: 'launch-2' });
  boxes.filter((b) => b.text === '  × dismiss')[0].click(); await flush();
  assert.deepEqual(f.net.requests().filter((r) => r.method === 'POST').map((r) => [r.path, r.body, r.headers.origin]), [['/api/fleet/launches/launch-2/dismiss', {}, ORIGIN]]);
  f.dispose();
});

test('sidebar: quiet "Nothing needs you" with working/stuck counts; unreachable; answer excerpts load lazily', async () => {
  const f = fixture({ snapshot: wireSnapshot([wireRow('w', 'working', { activityAt: NOW - 11 * 60_000 }), wireRow('w2', 'working'), wireRow('h', 'handled')]) });
  await flush();
  assert.deepEqual(sidebarBoxes(f.sidebar()).map((b) => b.text).slice(1, 4), ['', 'Nothing needs you', '2 working · 1 stuck']);
  f.dispose();
  const none = sidebarLines({ live: parseSnapshot(wireSnapshot([wireRow('h', 'handled')])), status: 'live', baseURL: 'u', now: NOW });
  assert.deepEqual(none.map((l) => l.parts.map((p) => p.text).join('')), ['Fleet', '', 'Nothing needs you', 'Nothing is working']);
  const down = sidebarLines({ live: undefined, status: 'unreachable', baseURL: 'https://f', now: NOW });
  assert.deepEqual(down.map((l) => l.parts.map((p) => p.text).join('').trimEnd()), ['Fleet', '', 'Fleet unreachable', 'https://f']);

  const g = fixture();
  g.net.respond('GET', '/api/fleet/sessions/ses_done_new/summary', 200, payloads.summary);
  g.net.respond('GET', '/api/fleet/sessions/ses_tmp/summary', 500, { error: 'Internal error' });
  await flush();
  assert.deepEqual(g.net.requests().map((r) => r.path), [
    `/api/fleet/sessions/ses_done_new/summary?idle=${NOW - 30 * 60_000}`, `/api/fleet/sessions/ses_tmp/summary?idle=${NOW - 10 * 60_000}`,
  ]);
  const lines = sidebarBoxes(g.sidebar()).map((b) => b.text);
  assert.equal(lines[lines.indexOf('  Done new') + 1], '  Added the palette.');
  assert.equal(lines[lines.indexOf('  Scratch') + 1], '');
  g.net.streams[0].send(change({ initial: false, rows: [] })); await flush();
  assert.equal(g.net.requests().length, 2);
  g.dispose();
});

test('ctrl+x h marks the current finished root handled (Origin header), optimistically; ctrl+x z reopens it', async () => {
  const f = fixture({ route: { type: 'session', sessionID: 'ses_done_new' } });
  await flush();
  f.slot('append', 'app').render();
  f.net.respond('POST', '/api/fleet/sessions/ses_done_new/handled', 200, { sessionID: 'ses_done_new', outcome: 'handled' });
  f.net.respond('POST', '/api/fleet/sessions/ses_done_new/reopen', 200, { sessionID: 'ses_done_new', outcome: 'reopened' });
  await f.run('fleet.handled');
  const posts = () => f.net.requests().filter((r) => r.method === 'POST');
  assert.deepEqual(posts().map((r) => [r.path, r.body, r.headers]), [
    ['/api/fleet/sessions/ses_done_new/handled', {}, { accept: 'application/json', 'content-type': 'application/json', origin: ORIGIN }],
  ]);
  let lines = sidebarBoxes(f.sidebar('ses_done_new'));
  assert.equal(lines[1].text, '✓ handled Done new · undo');
  assert.ok(!lines.some((b) => b.text === '  Done new'));
  assert.equal(lines.find((b) => b.text.startsWith('FINISHED')).text, 'FINISHED  3');
  assert.equal(text(f.slot('append', 'home.footer.status').render()), '⚑ 6 need you · 3 working · 2 stuck');
  assert.deepEqual(f.toasts.at(-1), { variant: 'success', message: 'Handled Done new · ctrl+x z to undo' });
  lines[1].click(); await flush();
  assert.deepEqual(posts().map((r) => r.path).at(-1), '/api/fleet/sessions/ses_done_new/reopen');
  lines = sidebarBoxes(f.sidebar('ses_done_new'));
  assert.ok(lines.some((b) => b.text === '  Done new' && b.selected));
  assert.deepEqual(f.toasts.at(-1), { variant: 'info', message: 'Reopened Done new' });
  await f.run('fleet.undo');
  assert.deepEqual(f.toasts.at(-1), { variant: 'info', message: 'Nothing to undo' });
  assert.equal(posts().length, 2);
  f.dispose();
});

test('handled: refused or failed calls roll back; only finished sessions qualify', async () => {
  const f = fixture({ route: { type: 'session', sessionID: 'ses_done_old' } });
  await flush();
  f.slot('append', 'app').render();
  f.net.respond('POST', '/api/fleet/sessions/ses_done_old/handled', 409, { error: 'Only a finished session can be marked handled' });
  await f.run('fleet.handled');
  assert.deepEqual(f.toasts.at(-1), { variant: 'error', message: 'Could not mark handled: Only a finished session can be marked handled' });
  assert.ok(sidebarBoxes(f.sidebar()).some((b) => b.text === '  Done old'));
  f.setRoute({ type: 'session', sessionID: 'ses_wait_old' });
  await f.run('fleet.handled');
  f.setRoute({ type: 'home' });
  await f.run('fleet.handled');
  assert.deepEqual(f.toasts.slice(-2).map((t) => t.message), ['Only a finished session can be marked handled', 'Open a finished session first']);
  assert.equal(f.net.requests().filter((r) => r.method === 'POST').length, 1);
  f.dispose();
});

test('ctrl+x o launches a worktree and lands in its session when ready, unless the user moved on', async () => {
  const f = fixture({
    route: { type: 'session', sessionID: 'ses_wait_old' },
    pick: (options) => options.find((o) => o.title === '+ New worktree in fleet…').value,
    prompts: ['Add dark mode', 'feat/dark-mode'],
  });
  f.net.respond('GET', '/api/fleet/launcher', 200, payloads.launcher);
  f.net.respond('POST', '/api/fleet/launcher/branch', 200, { branch: 'feat/dark-mode', source: 'fallback' });
  f.net.respond('POST', '/api/fleet/launches', 200, { launchID: 'launch-9' });
  await flush();
  f.net.streams[0].send(change({ initial: true })); await flush();
  f.slot('append', 'app').render();
  await f.run('fleet.launcher');
  assert.equal(f.dialogs[0].title, 'Fleet: New / open');
  assert.deepEqual(f.net.requests().filter((r) => r.method === 'POST').map((r) => [r.path, r.body, r.headers.origin]), [
    ['/api/fleet/launcher/branch', { task: 'Add dark mode' }, ORIGIN],
    ['/api/fleet/launches', { repoDir: '/home/magoz/dev/repos/fleet', branch: 'feat/dark-mode', task: 'Add dark mode' }, ORIGIN],
  ]);
  const launch = wireLaunch({ id: 'launch-9', branch: 'feat/dark-mode' });
  f.net.streams[0].send(change({ initial: false, launches: [launch] })); await flush();
  assert.ok(sidebarBoxes(f.sidebar()).some((b) => b.text.startsWith('◌ feat/dark-mode · fleet')));
  assert.equal(f.timers.intervals(), 2);
  f.net.streams[0].send(change({ initial: false, launches: [{ ...launch, status: 'ready', sessionID: 'ses_launched' }] })); await flush();
  assert.deepEqual(f.navigations.at(-1), { type: 'session', sessionID: 'ses_launched' });
  assert.equal(f.timers.intervals(), 1);
  f.dispose();
});

test('ctrl+x j jumps through the needs-me list in order; toasts when nothing needs you', async () => {
  const f = fixture({ route: { type: 'session', sessionID: 'ses_wait_new' } });
  await flush();
  f.slot('append', 'app').render();
  f.run('fleet.next');
  assert.deepEqual(f.navigations.at(-1), { type: 'session', sessionID: 'ses_wait_sub' });
  f.run('fleet.next');
  assert.deepEqual(f.navigations.at(-1), { type: 'session', sessionID: 'ses_done_old' });
  const g = fixture({ snapshot: wireSnapshot([wireRow('w', 'working')]) });
  await flush();
  g.slot('append', 'app').render();
  g.run('fleet.next');
  assert.deepEqual(g.toasts.map((t) => t.message), ['Nothing needs you']);
  f.dispose(); g.dispose();
});

test('page: needs me then working with stuck labels; j/k move; enter opens; h handles; o web; esc returns', async () => {
  const f = fixture();
  await flush();
  f.slot('append', 'app').render();
  f.run('fleet.open');
  assert.deepEqual(f.navigations.at(-1), { type: 'plugin', name: ROUTE });
  const page = f.routes[0].render({});
  const screen = text(page);
  assert.match(screen, /^Fleet +connecting…/);
  assert.match(screen, /BLOCKED {2}3\n› ■ fleet · Wait old +bash: pnpm db:push · 3h/);
  assert.match(screen, /FINISHED {2}4\n {2}▪ fleet · Done old +run failed · 5h/);
  assert.match(screen, /WORKING {2}3\n {2}◧ fleet · Quiet run +quiet 15m\n {2}◧ fleet · fleet-feat-x · Retry run +retrying \(2×, rate limited\)\n {2}◧ fleet · Busy run +bash: pnpm test\n/);
  assert.doesNotMatch(screen, /Handled one|Box route|Gone scratch/);
  f.run('j');
  assert.match(text(page), /› ■ fleet · fleet-feat-x · Wait new/);
  f.run('return');
  assert.deepEqual(f.navigations.at(-1), { type: 'session', sessionID: 'ses_wait_new' });
  f.setRoute({ type: 'plugin', name: ROUTE });
  f.run('o'); await flush();
  assert.deepEqual(f.opened, ['https://box.tail129a86.ts.net:9446/server/aHR0cHM6Ly9ib3gudGFpbDEyOWE4Ni50cy5uZXQ6OTQ0Ng/session/ses_wait_new']);
  f.net.respond('POST', '/api/fleet/sessions/ses_done_old/handled', 200, { sessionID: 'ses_done_old', outcome: 'handled' });
  f.run('j'); f.run('j');
  f.run('h'); await flush();
  assert.deepEqual(f.net.requests().filter((r) => r.method === 'POST').map((r) => r.path), ['/api/fleet/sessions/ses_done_old/handled']);
  f.run('escape');
  assert.deepEqual(f.navigations.at(-1), { type: 'home' });
  f.dispose();
});

test('notifications: none for the first snapshot; gaps mode batches → blocked from a subagent; blurred only, no sound', async () => {
  const f = fixture({ snapshot: wireSnapshot([wireRow('a', 'working'), wireRow('b', 'working')]) });
  await flush();
  f.net.streams[0].send(change({ initial: true })); await flush();
  assert.equal(f.notified.length, 0);
  f.net.streams[0].send(change({ initial: false, rows: [wireRow('a', 'blocked', { ownState: 'working' }), wireRow('b', 'blocked')] }));
  await flush();
  assert.equal(f.notified.length, 0);
  await f.timers.run(1500);
  assert.deepEqual(f.notified, [{ title: 'Fleet', message: 'box · T a needs you', notification: { when: 'blurred' }, sound: false }]);
  f.dispose();
});

test('dispose stops timers, stream and requests; removes contributions', async () => {
  const f = fixture();
  await flush();
  assert.equal(f.timers.intervals(), 2);
  f.dispose();
  await flush();
  assert.equal(f.timers.intervals(), 0);
  assert.deepEqual(f.timers.delays(), []);
  assert.equal(f.slots.length, 0);
  assert.equal(f.routes.length, 0);
});

test('layout helpers: truncation, scroll window, unreachable page text', () => {
  const live = parseSnapshot(wireSnapshot([wireRow('h', 'handled'), wireRow('d', 'finished', { title: 'x'.repeat(200) })]));
  const lines = pageLines({ live, status: 'live', baseURL: 'u', now: NOW, cols: 60 });
  assert.deepEqual(selectableIDs(lines), ['d']);
  assert.ok(lines.every((l) => [...l.parts.map((p) => p.text).join('')].length <= 60));
  assert.equal(pageLines({ live: undefined, status: 'unreachable', baseURL: 'https://f', now: NOW, cols: 60 })[0].parts[0].text, 'Fleet unreachable at https://f');
  assert.equal(fit('abcdef', 4), 'abc…');
  assert.deepEqual([scrollTop(0, 3, 10, 5), scrollTop(0, 7, 10, 5), scrollTop(5, 2, 10, 5), scrollTop(3, 1, 4, 5)], [0, 3, 1, 0]);
});

test('notifier dedupes repeats within the quiet window', async () => {
  const timers = fakeTimers(), sent = [];
  let now = 0;
  const live = parseSnapshot(wireSnapshot([wireRow('a', 'blocked')]));
  const notifier = createNotifier({ send: (m) => sent.push(m), live: () => live, timers, now: () => now });
  const t = [{ kind: 'blocked', row: live.rows.get('a') }];
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
