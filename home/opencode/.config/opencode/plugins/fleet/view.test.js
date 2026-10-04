import test from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_TONES, ROUTE, SIDEBAR_COLS, cells, createNotifier, fit, openURL, pageLines, scrollTop, selectableIDs, setupFleet, sidebarLines } from './view.js';
import { parseSnapshot } from './fleet.js';
import { NOW, change, fakeFetch, fakeTimers, flush, payloads, wireLaunch, wireRow, wireSnapshot } from './fixtures.js';

const ORIGIN = 'https://fleet.oox.sh';
const minute = 60_000;

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
const kids = (node) => node.children.flatMap(flat).filter((c) => c !== null && c !== undefined);
/** Every span under `node`: `{ text, fg, bold }`. */
const spans = (node) => flat(node).flatMap((n) => (n && typeof n === 'object'
  ? n.tag === 'span' ? [{ text: text(n), fg: n.props.style.fg, bold: n.props.style.bold === true }] : kids(n).flatMap(spans)
  : []));
/**
 * The sidebar's entry boxes: `{ lines, band, click, over, out, targets, spans }`; `targets` are the
 * separate click targets inside (`✕`, the counts).
 */
const sidebarEntries = (node) => kids(flat(node)[0]).map((entry) => ({
  lines: kids(entry).map(text), band: entry.props.backgroundColor, spans: spans(entry),
  click: entry.props.onMouseUp, over: entry.props.onMouseOver, out: entry.props.onMouseOut,
  targets: kids(entry).flatMap(kids).filter((t) => t.props.onMouseUp)
    .map((t) => ({ text: text(t), click: t.props.onMouseUp, over: t.props.onMouseOver, out: t.props.onMouseOut, spans: spans(t) })),
}));
const sidebarText = (node) => sidebarEntries(node).flatMap((e) => e.lines.map((l) => l.trimEnd()));
const lineText = (entries) => entries.flatMap((e) => e.lines.map((parts) => parts.map((p) => p.text).join('').trimEnd()));
const click = () => { const event = { stopped: false, stopPropagation() { event.stopped = true; } }; return event; };

const color = (name) => `#${name}`;
/** Theme tokens the Fleet UI must never read: OpenCode's warning and accent (orange in Tokyonight). */
const forbidden = [];
const watched = (name, value) => ({ get() { forbidden.push(name); return value; }, enumerable: true });
const theme = {
  text: {
    base: color('base'), muted: color('muted'), formfield: { selected: color('current'), base: color('formfield') },
    feedback: Object.defineProperties({ error: { base: color('error') }, success: { base: color('success') } }, {
      warning: watched('text.feedback.warning', { base: color('warning') }), info: watched('text.feedback.info', { base: color('info') }),
    }),
  },
  hue: Object.defineProperties({ interactive: { 200: color('running') } }, { accent: watched('hue.accent', { 200: color('accent') }) }),
  background: { base: color('bg'), raised: { high: color('raised'), base: color('panel') } },
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
  const sidebar = (sessionID = 'ses_x') => slot('prepend', 'sidebar.content').render({ sessionID });
  return { ctx, net, timers, layers, slots, routes, navigations, toasts, notified, opened, dialogs, dispose, commands, run, slot, sidebar, setRoute: (r) => { route = r; } };
}

test('registers the sidebar section (prepended), page, footer badges and leader commands on free keys', async () => {
  const f = fixture();
  await flush();
  assert.deepEqual(f.routes.map((r) => r.name), [ROUTE]);
  assert.deepEqual(f.slots.map((s) => Object.entries(s).find(([k]) => k !== 'render')), [
    ['append', 'app'], ['prepend', 'sidebar.content'], ['append', 'home.footer.status'], ['append', 'prompt.footer.status'],
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

test('badge: ⚑ and "N need you" in Fleet green (success), working base, stuck red; muted when subtle', async () => {
  assert.deepEqual(BADGE_TONES, { need: 'attention', working: 'base', stuck: 'error' });
  const f = fixture();
  await flush();
  f.net.streams[0].send(change({ initial: true })); await flush();
  assert.deepEqual(spans(f.slot('append', 'home.footer.status').render()).map((s) => [s.text, s.fg]), [
    ['⚑ ', '#success'], ['7 need you', '#success'], [' · ', '#muted'], ['3 working', '#base'], [' · ', '#muted'], ['2 stuck', '#error'],
  ]);
  f.dispose();
  const g = fixture({ snapshot: wireSnapshot([wireRow('w', 'working')], 'disconnected') });
  await flush();
  assert.deepEqual(spans(g.slot('append', 'home.footer.status').render()).map((s) => s.fg), ['#muted', '#muted']);
  g.dispose();
});

test('sidebar: one Fleet title with counts, then one line per entry: launches, blocked (with the ask), finished, +N more', async () => {
  const f = fixture();
  assert.deepEqual(sidebarText(f.sidebar()), [`Fleet${' '.repeat(21)}connecting…`, 'fleet.oox.sh']);
  await flush();
  f.net.streams[0].send(change({ initial: true })); await flush();
  const entries = sidebarEntries(f.sidebar('ses_done_new'));
  assert.deepEqual(entries.map((e) => e.lines.map((l) => l.trimEnd())), [
    ['Fleet             3 working · 2 stuck'],
    [' ◌ feat/palette · fleet          0:42'],
    [' • fix/broken · fleet        failed ✕'],
    [' • feat/x · fleet             ready ✕'],
    [' ! fleet Wait old                  3h', '   bash: pnpm db:push'],
    [' ? fleet Wait new                  1h', '   Ship it?'],
    [' ? fleet Wait on subagent         50m', '   explore asks: Which database?'],
    [' • fleet Done old              failed'],
    [' • fleet Stopped run          stopped'],
    ['▌• fleet this session             30m'],
    [' +1 more · ctrl+x f'],
  ]);
  for (const line of entries.flatMap((e) => e.lines)) assert.ok(cells(line) <= SIDEBAR_COLS, line);
  assert.doesNotMatch(entries.flatMap((e) => e.lines).join('\n'), /Nothing is working|ctrl\+x [jhzo]|BLOCKED|FINISHED|LAUNCHES|[■▪◧□]/);

  // Colours: green markers, red failures, blue running launch and current session; muted meta.
  const fg = (entry, str) => entry.spans.find((s) => s.text === str)?.fg;
  assert.equal(fg(entries[0], 'Fleet'), '#base');
  assert.deepEqual(entries[0].spans.filter((s) => /working|stuck/.test(s.text)).map((s) => s.fg), ['#muted', '#error']);
  assert.deepEqual([fg(entries[1], '◌'), fg(entries[2], '•'), fg(entries[2], 'failed'), fg(entries[3], '•'), fg(entries[3], 'ready')],
    ['#running', '#error', '#error', '#success', '#success']);
  assert.deepEqual([fg(entries[4], '!'), fg(entries[4], 'fleet '), fg(entries[4], 'Wait old'), fg(entries[4], '3h'), fg(entries[4], '  bash: pnpm db:push')],
    ['#success', '#muted', '#base', '#muted', '#muted']);
  assert.deepEqual([fg(entries[5], '?'), fg(entries[7], '•'), fg(entries[7], 'failed'), fg(entries[8], '•'), fg(entries[8], 'stopped')],
    ['#success', '#error', '#error', '#success', '#base']);
  const current = entries[9];
  assert.deepEqual(current.spans.filter((s) => s.text === '▌' || s.text === 'this session').map((s) => [s.text, s.fg, s.bold]),
    [['▌', '#current', false], ['this session', '#current', true]]);
  assert.ok(entries.every((e) => e.band === undefined), 'no background until hovered, the current session included');

  // Hover: one band over the whole entry, one entry at a time.
  entries[4].over();
  let hovered = sidebarEntries(f.sidebar('ses_done_new'));
  assert.deepEqual(hovered.map((e) => e.band).map((b, i) => [i, b]).filter(([, b]) => b), [[4, '#raised']]);
  entries[4].out(); entries[5].over();
  hovered = sidebarEntries(f.sidebar('ses_done_new'));
  assert.deepEqual(hovered.map((e, i) => [i, e.band]).filter(([, b]) => b), [[5, '#raised']]);
  entries[5].out();
  assert.ok(sidebarEntries(f.sidebar('ses_done_new')).every((e) => e.band === undefined));
  assert.equal(entries[0].band, undefined);

  // Clicks: an entry opens its session; ✕ only dismisses its launch; the counts and +N more open the page.
  entries[4].click();
  entries[3].click();
  assert.deepEqual(f.navigations, [{ type: 'session', sessionID: 'ses_wait_old' }, { type: 'session', sessionID: 'ses_busy' }]);
  f.net.respond('POST', '/api/fleet/launches/launch-2/dismiss', 200, { launchID: 'launch-2' });
  assert.deepEqual(entries[2].targets.map((t) => t.text), ['✕']);
  const event = click();
  entries[2].targets[0].click(event); await flush();
  assert.equal(event.stopped, true, '✕ does not also click its entry');
  assert.deepEqual(f.net.requests().filter((r) => r.method === 'POST').map((r) => [r.path, r.body, r.headers.origin]), [['/api/fleet/launches/launch-2/dismiss', {}, ORIGIN]]);
  assert.equal(f.navigations.length, 2);
  entries[2].click();
  const failed = payloads.snapshot.launches[1];
  assert.deepEqual(f.toasts.at(-1), { variant: 'error', message: `Launch of fix/broken failed: ${failed.error} (kept: ${failed.preserved})` });
  assert.deepEqual(entries[0].targets.map((t) => t.text), ['3 working · 2 stuck']);
  entries[0].targets[0].over();
  assert.deepEqual(sidebarEntries(f.sidebar('ses_done_new'))[0].targets[0].spans.map((s) => s.fg), ['#base', '#base', '#error']);
  entries[0].targets[0].out();
  entries[0].targets[0].click(click());
  assert.deepEqual(f.navigations.at(-1), { type: 'plugin', name: ROUTE });
  f.setRoute({ type: 'home' });
  entries.at(-1).click();
  assert.deepEqual(f.navigations.at(-1), { type: 'plugin', name: ROUTE });
  f.dispose();
});

test('sidebar degrades to two lines: nothing needs you; unreachable; reconnecting and stale lists', async () => {
  const f = fixture({ snapshot: wireSnapshot([wireRow('w', 'working', { activityAt: NOW - 11 * minute }), wireRow('w2', 'working'), wireRow('h', 'handled')]) });
  await flush();
  f.net.streams[0].send(change({ initial: true })); await flush();
  assert.deepEqual(sidebarText(f.sidebar()), ['Fleet             2 working · 1 stuck', 'Nothing needs you']);
  assert.equal(sidebarEntries(f.sidebar())[1].spans[0].fg, '#muted');
  f.dispose();
  const quiet = sidebarLines({ live: parseSnapshot(wireSnapshot([wireRow('h', 'handled')])), status: 'live', baseURL: 'u', now: NOW });
  assert.deepEqual(lineText(quiet), ['Fleet', 'Nothing needs you']);
  const down = sidebarLines({ live: undefined, status: 'unreachable', baseURL: 'https://fleet.oox.sh', now: NOW });
  assert.deepEqual(lineText(down), ['Fleet                     unreachable', 'fleet.oox.sh · retrying…']);
  assert.equal(down[0].lines[0].at(-1).tone, 'error');

  const live = parseSnapshot(wireSnapshot([wireRow('a', 'blocked'), wireRow('b', 'finished', { outcome: 'failed' }), wireRow('w', 'working')]));
  const view = (status, l = live) => sidebarLines({ live: l, status, baseURL: 'u', now: NOW, currentID: 'b' });
  assert.deepEqual(lineText(view('reconnecting')), ['Fleet                   reconnecting…', ' ? box T a                         1m', '   needs you', '▌• box this session            failed']);
  assert.ok(view('reconnecting').slice(1).some((e) => e.lines.flat().some((p) => p.tone !== 'muted')), 'reconnecting keeps the list as is');
  for (const [status, l, label] of [['unreachable', live, 'unreachable'], ['live', parseSnapshot(wireSnapshot([wireRow('a', 'blocked')], 'disconnected')), 'Fleet lost OpenCode']]) {
    const entries = view(status, l);
    assert.equal(lineText(entries)[0], `Fleet${' '.repeat(SIDEBAR_COLS - 5 - label.length)}${label}`);
    assert.ok(entries.slice(1).every((e) => e.lines.flat().every((p) => p.tone === 'muted')), `${status}: the list is dimmed`);
  }
});

test('sidebar with the S2 data (inside a finished session, nothing working) reads like mock (d)', async () => {
  const fleetDir = '/home/magoz/dev/repos/fleet';
  const s2 = {
    generatedAt: NOW, counts: payloads.snapshot.counts, connection: { status: 'connected', since: NOW, failures: 0 }, launches: [],
    projects: [
      { id: 'fleet', name: 'fleet', directory: fleetDir, worktrees: [{ directory: fleetDir, kind: 'root', rows: [
        wireRow('ses_greeting', 'finished', { title: 'Greeting', projectID: 'fleet', directory: fleetDir, activeAt: NOW - 4 * minute }),
      ] }] },
      { id: 'global', name: 'global', directory: '/', worktrees: [{ directory: '/tmp', kind: 'directory', rows: [
        wireRow('ses_ok', 'finished', { title: 'Request for exact "ok" reply', projectID: 'global', directory: '/tmp', activeAt: NOW - 3 * 60 * minute }),
      ] }] },
    ],
  };
  const f = fixture({ snapshot: s2, route: { type: 'session', sessionID: 'ses_ok' } });
  await flush();
  f.net.streams[0].send(change({ initial: true })); await flush();
  const entries = sidebarEntries(f.sidebar('ses_ok'));
  assert.deepEqual(entries.map((e) => e.lines.map((l) => l.trimEnd())), [
    ['Fleet'],
    ['▌• tmp this session                3h'],
    [' • fleet Greeting                  4m'],
  ]);
  const all = entries.flatMap((e) => e.lines).join('\n');
  assert.doesNotMatch(all, /Request for exact|Nothing is working|ctrl\+x/, 'the title shows once (in the host), no hints');
  assert.deepEqual(entries[1].spans.filter((s) => s.fg === '#current').map((s) => s.text), ['▌', 'this session']);
  assert.ok(entries.every((e) => e.band === undefined));
  assert.equal(text(f.slot('append', 'prompt.footer.status').render({ sessionID: 'ses_ok' })), '⚑ 2 need you');
  assert.deepEqual(spans(f.slot('append', 'prompt.footer.status').render({ sessionID: 'ses_ok' })).map((s) => s.fg), ['#success', '#success']);
  entries[2].click();
  assert.deepEqual(f.navigations.at(-1), { type: 'session', sessionID: 'ses_greeting' });
  f.dispose();
});

test('sidebar caps at 6 session rows plus +N more, blocked first, always keeping the current session', () => {
  const rows = Array.from({ length: 9 }, (_, i) => wireRow(`s${i + 1}`, i < 2 ? 'blocked' : 'finished', { activeAt: NOW - (20 - i) * minute }));
  const live = parseSnapshot(wireSnapshot(rows, 'connected', [wireLaunch()]));
  const view = (currentID) => sidebarLines({ live, status: 'live', baseURL: 'u', now: NOW, currentID, pageKey: 'ctrl+x f' });
  const sessions = (entries) => entries.filter((e) => e.key.startsWith('row:')).map((e) => e.key.slice(4));
  assert.deepEqual(sessions(view('s9')), ['s1', 's2', 's3', 's4', 's5', 's9']);
  assert.equal(lineText(view('s9')).at(-1), ' +3 more · ctrl+x f');
  assert.ok(lineText(view('s9')).includes('▌• box this session               12m'));
  assert.deepEqual(sessions(view('s4')), ['s1', 's2', 's3', 's4', 's5', 's6']);
  assert.deepEqual(sessions(view(undefined)), ['s1', 's2', 's3', 's4', 's5', 's6']);
  assert.equal(view('s9').filter((e) => e.key.startsWith('launch:')).length, 1, 'launches do not count');
  assert.equal(lineText(sidebarLines({ live, status: 'live', baseURL: 'u', now: NOW })).at(-1), ' +3 more');
  assert.equal(view('s9').at(-1).action.type, 'page');
});

test('sidebar lines never exceed the sidebar width, measured with Bun.stringWidth when available', () => {
  const long = 'x'.repeat(80), wide = '日本語のタイトルがとても長いセッションです';
  const live = parseSnapshot(wireSnapshot([
    wireRow('a', 'blocked', { title: long, permissions: [{ id: 'p', sessionID: 'a', action: 'bash', resources: [long] }], pending: { permissions: 1, forms: 0 } }),
    wireRow('b', 'finished', { title: wide, outcome: 'interrupted', interrupt: 'user' }), wireRow('c', 'finished', { title: wide }),
  ], 'connected', [wireLaunch({ branch: `feat/${long}`, repoName: 'a-very-long-repository-name' })]));
  const render = (cols) => lineText(sidebarLines({
    live, status: 'live', baseURL: 'u', now: NOW, currentID: 'c', cols, pageKey: 'ctrl+x f',
    lastHandled: { title: wide, at: NOW },
  }));
  // Under node, a stand-in Bun.stringWidth (CJK is 2 cells) and the code-point fallback; under Bun
  // (where `globalThis.Bun` is read-only), the real one.
  const original = globalThis.Bun, underBun = typeof original?.stringWidth === 'function';
  const fake = { stringWidth: (s) => [...s].reduce((n, ch) => n + (/[\u3000-\u9fff]/.test(ch) ? 2 : 1), 0) };
  try {
    for (const bun of underBun ? [original] : [undefined, fake]) {
      if (!underBun) globalThis.Bun = bun;
      for (const cols of [SIDEBAR_COLS, 30]) {
        const lines = render(cols);
        assert.ok(lines.length >= 6);
        for (const line of lines) assert.ok(cells(line) <= cols, `${cells(line)} > ${cols}: ${line}`);
        assert.ok(lines.some((l) => l.includes('…')));
      }
      if (bun) {
        assert.equal(fit('日本語', 4), '日…');
        assert.equal(cells('日本'), 4);
        const row = render(SIDEBAR_COLS).find((l) => l.startsWith(' • box 日本'));
        assert.match(row, /^ • box 日本語のタイトル…  interrupted$/);
        assert.equal(cells(row), SIDEBAR_COLS, 'wide titles are cut by cells; the gap absorbs the odd cell');
      }
    }
  } finally { if (!underBun) globalThis.Bun = original; }
  const rows = lineText(sidebarLines({ live, status: 'live', baseURL: 'u', now: NOW, currentID: 'c', lastHandled: { title: wide, at: NOW } }));
  assert.match(rows[1], /^ ✓ Handled 日本語.*… · undo$/);
  assert.match(rows[2], /^ ◌ feat\/x+… · a-very-lo… +0:\d\d$/, 'the branch is cut first; the clock is never cut');
  assert.match(rows[4], /^ {3}bash: x+…$/);
});

test('the Fleet UI never reads warning or accent tokens and uses only base/muted/error/green/blue tones', async () => {
  forbidden.length = 0;
  const f = fixture({ route: { type: 'session', sessionID: 'ses_done_new' } });
  await flush();
  f.net.streams[0].send(change({ initial: true })); await flush();
  sidebarEntries(f.sidebar('ses_done_new'));
  text(f.slot('append', 'home.footer.status').render());
  text(f.routes[0].render({}));
  f.dispose();
  const g = fixture({ snapshot: wireSnapshot([wireRow('w', 'working')], 'disconnected') });
  await flush();
  sidebarEntries(g.sidebar()); text(g.slot('append', 'home.footer.status').render());
  g.dispose();
  assert.deepEqual(forbidden, []);
  const live = parseSnapshot(payloads.snapshot);
  const tones = new Set();
  for (const status of ['live', 'reconnecting', 'unreachable', 'connecting']) {
    for (const l of [live, undefined]) {
      for (const e of sidebarLines({ live: l, status, baseURL: 'u', now: NOW, currentID: 'ses_done_new', lastHandled: { title: 't', at: NOW } })) {
        for (const p of e.lines.flat()) tones.add(p.tone);
      }
    }
  }
  for (const l of pageLines({ live, status: 'live', baseURL: 'u', now: NOW, cols: 80, selectedID: 'ses_wait_old' })) for (const p of l.parts) tones.add(p.tone);
  assert.deepEqual([...tones].filter((t) => !['base', 'muted', 'error', 'attention', 'current', 'running'].includes(t)), []);
});

test('answer excerpts load lazily for the page, two at a time, failures not retried', async () => {
  const g = fixture();
  g.net.respond('GET', '/api/fleet/sessions/ses_done_new/summary', 200, payloads.summary);
  g.net.respond('GET', '/api/fleet/sessions/ses_tmp/summary', 500, { error: 'Internal error' });
  await flush();
  assert.deepEqual(g.net.requests().map((r) => r.path), [
    `/api/fleet/sessions/ses_done_new/summary?idle=${NOW - 30 * minute}`, `/api/fleet/sessions/ses_tmp/summary?idle=${NOW - 10 * minute}`,
  ]);
  assert.match(text(g.routes[0].render({})), /fleet · fleet-feat-x · Done new +Added the palette\. · 30m/);
  assert.doesNotMatch(sidebarText(g.sidebar()).join('\n'), /Added the palette/, 'the sidebar leaves answers to the session');
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
  assert.ok(sidebarText(f.sidebar('ses_done_new')).includes('▌• fleet this session             30m'));
  await f.run('fleet.handled');
  const posts = () => f.net.requests().filter((r) => r.method === 'POST');
  assert.deepEqual(posts().map((r) => [r.path, r.body, r.headers]), [
    ['/api/fleet/sessions/ses_done_new/handled', {}, { accept: 'application/json', 'content-type': 'application/json', origin: ORIGIN }],
  ]);
  const entries = sidebarEntries(f.sidebar('ses_done_new'));
  const lines = entries.flatMap((e) => e.lines.map((l) => l.trimEnd()));
  assert.equal(lines[1], ' ✓ Handled Done new · undo');
  assert.deepEqual(entries[1].spans.map((s) => [s.text, s.fg]).at(-1), ['undo', '#base']);
  assert.ok(!lines.some((l) => l.startsWith('▌')));
  assert.ok(!lines.some((l) => l.includes('more')), 'six rows left: no +N more');
  assert.equal(text(f.slot('append', 'home.footer.status').render()), '⚑ 6 need you · 3 working · 2 stuck');
  assert.deepEqual(f.toasts.at(-1), { variant: 'success', message: 'Handled Done new · ctrl+x z to undo' });
  entries[1].click(); await flush();
  assert.deepEqual(posts().map((r) => r.path).at(-1), '/api/fleet/sessions/ses_done_new/reopen');
  assert.ok(sidebarText(f.sidebar('ses_done_new')).includes('▌• fleet this session             30m'));
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
  assert.ok(sidebarText(f.sidebar()).includes(' • fleet Done old              failed'));
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
  assert.ok(sidebarText(f.sidebar()).some((l) => l.startsWith(' ◌ feat/dark-mode · fleet')));
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
  assert.match(screen, /Blocked 3\n› ! fleet · Wait old +bash: pnpm db:push · 3h/);
  assert.match(screen, /Finished 4\n {2}• fleet · Done old +run failed · 5h/);
  assert.match(screen, /Working 3\n {2}◌ fleet · Quiet run +quiet 15m\n {2}◌ fleet · fleet-feat-x · Retry run +retrying \(2×, rate limited\)\n {2}◌ fleet · Busy run +bash: pnpm test\n/);
  assert.doesNotMatch(screen, /Handled one|Box route|Gone scratch/);
  f.run('j');
  assert.match(text(page), /› \? fleet · fleet-feat-x · Wait new/);
  f.run('return');
  assert.deepEqual(f.navigations.at(-1), { type: 'session', sessionID: 'ses_wait_new' });
  f.setRoute({ type: 'plugin', name: ROUTE });
  f.run('o'); await flush();
  assert.deepEqual(f.opened, ['https://fleet.oox.sh/server/aHR0cHM6Ly9mbGVldC5vb3guc2g/session/ses_wait_new']);
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
