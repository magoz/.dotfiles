// Fleet terminal view: focus sidebar, footer badge, full-page route, commands, handled/undo,
// launcher and notifications. The OpenTUI Solid runtime is injected (see tui.js), so this module
// builds elements without a JSX build step and runs under node --test with a fake runtime.
import { spawn } from 'node:child_process';
import {
  BADGE_MARK, askKind, askText, badgeView, buildBoard, elapsedText, launchRunning, names, nextNeedsMe, notification, notifyMode,
  relativeTime, resolveBaseURL, resolveKeys, rowLabel, rowReason, titleOf, transitions, withOverrides,
} from './fleet.js';
import { createFleetApi } from './api.js';
import { createLaunchWatch, runLauncher } from './launcher.js';
import { createFleetSource } from './source.js';

export const ROUTE = 'fleet';
/**
 * Content width of OpenCode's session sidebar: `SESSION_SIDEBAR_WIDTH` 42 minus its 2+2 padding,
 * minus the 1 column the `sidebar.content` box keeps for the scrollbar (`routes/session/sidebar.tsx`).
 */
export const SIDEBAR_COLS = 37;
/** The sidebar offers undo for this long after a handled. */
export const UNDO_WINDOW = 5 * 60 * 1000;
/** Footer badge part tones: `N need you` is Fleet's green, never OpenCode's warning orange. */
export const BADGE_TONES = { need: 'attention', working: 'base', stuck: 'error' };
/** Session rows the sidebar shows before `+N more`; launches do not count. */
export const SIDEBAR_ROWS = 6;
/** The project name in a sidebar row is cut to this many cells. */
const PROJECT_COLS = 10;

/**
 * Row markers: green (attention) for what needs me, red for failures, blue for work in progress.
 * Blocked rows say what they wait on: `!` a permission, `?` a question (own or a subagent's).
 */
export function marker(row) {
  if (row.state === 'blocked') return { text: askKind(row) === 'permission' ? '!' : '?', tone: 'attention' };
  if (row.state === 'finished') return { text: '•', tone: row.outcome === 'failed' ? 'error' : 'attention' };
  if (row.state === 'working') return { text: '◌', tone: 'running' };
  return { text: '•', tone: 'muted' };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** Terminal cells of `text`: `Bun.stringWidth` under Bun (OpenCode's runtime), else code points. */
export function cells(text) {
  const stringWidth = globalThis.Bun?.stringWidth;
  return typeof stringWidth === 'function' ? stringWidth(text) : [...text].length;
}

/** `text` in at most `max` cells, cut by grapheme with a single `…`. */
export function fit(text, max) {
  if (max <= 0) return '';
  if (cells(text) <= max) return text;
  let out = '';
  for (const { segment } of segmenter.segment(text)) {
    if (cells(`${out}${segment}…`) > max) break;
    out += segment;
  }
  return `${out}…`;
}

/**
 * One line in `cols` cells: `left` parts, then `right` parts flush right (never cut, at least one
 * space before them). When `left` does not fit, the part marked `cut` (a title) shrinks first,
 * then parts are cut from the end.
 */
function spread(left, right, cols) {
  const rightWidth = right.reduce((n, p) => n + cells(p.text), 0);
  const room = cols - (rightWidth ? rightWidth + 1 : 0);
  const fixed = left.reduce((n, p) => n + (p.cut ? 0 : cells(p.text)), 0);
  let used = 0;
  const parts = left.map(({ cut, ...part }) => {
    const text = fit(cut ? fit(part.text, room - fixed) : part.text, room - used);
    used += cells(text);
    return { ...part, text };
  });
  if (!rightWidth) return parts;
  return [...parts, { text: ' '.repeat(Math.max(1, cols - used - rightWidth)), tone: 'muted' }, ...right];
}

/** Header status label. */
export function statusLabel(status, live) {
  if (status === 'unreachable') return { text: 'unreachable', tone: 'error' };
  if (live && live.connection !== 'connected') return { text: 'Fleet lost OpenCode', tone: 'muted' };
  if (status === 'live') return { text: 'live', tone: 'muted' };
  return { text: status === 'reconnecting' ? 'reconnecting…' : 'connecting…', tone: 'muted' };
}

/** `4 working · 1 stuck`, non-zero parts only; nothing when nothing works. */
function countParts(counts, action) {
  if (!counts.working) return [];
  return [
    { text: `${counts.working} working`, tone: 'muted', action },
    ...(counts.stuck ? [{ text: ' · ', tone: 'muted', action }, { text: `${counts.stuck} stuck`, tone: 'error', action }] : []),
  ];
}

const gutter = (current) => ({ text: current ? '▌' : ' ', tone: 'current' });

/** What a finished row says on the right instead of its age: `failed`, `stopped`, `interrupted`. */
function endWord(row) {
  if (row.outcome === 'failed') return { text: 'failed', tone: 'error' };
  if (row.outcome === 'interrupted') return { text: row.interrupt === 'inactivity' ? 'stopped' : 'interrupted', tone: 'base' };
  return undefined;
}

function sessionEntry(live, row, now, current, cols) {
  const mark = marker(row);
  const right = (row.state === 'finished' && endWord(row)) || { text: relativeTime(row.activeAt, now), tone: 'muted' };
  const title = current ? { text: 'this session', tone: 'current', bold: true } : { text: titleOf(row), tone: 'base' };
  const lines = [spread([
    gutter(current), { text: mark.text, tone: mark.tone }, { text: ' ', tone: 'base' },
    { text: `${fit(names(live, row).project, PROJECT_COLS)} `, tone: 'muted' }, { ...title, cut: true },
  ], [right], cols)];
  // The current session's ask is already on screen in its chat.
  if (row.state === 'blocked' && !current) lines.push([gutter(false), { text: fit(`  ${askText(row)}`, cols - 1), tone: 'muted' }]);
  return { key: `row:${row.id}`, action: { type: 'open', sessionID: row.id }, current, lines };
}

function launchEntry(launch, now, cols) {
  const running = launchRunning(launch), ready = launch.status === 'ready';
  const mark = running ? { text: '◌', tone: 'running' } : { text: '•', tone: ready ? 'attention' : 'error' };
  const right = running
    ? [{ text: elapsedText(Math.max(now, launch.updatedAt) - launch.startedAt), tone: 'muted' }]
    : [{ text: ready ? 'ready' : 'failed', tone: ready ? 'attention' : 'error' }, { text: ' ', tone: 'muted' },
      { text: '✕', tone: 'muted', action: { type: 'dismiss', launchID: launch.id } }];
  const action = ready && launch.sessionID ? { type: 'open', sessionID: launch.sessionID }
    : launch.status === 'failed' ? { type: 'launch-failed', launch } : undefined;
  return { key: `launch:${launch.id}`, action, lines: [spread([
    gutter(false), { text: mark.text, tone: mark.tone }, { text: ' ', tone: 'base' },
    { text: launch.branch, tone: 'base', cut: true }, { text: ` · ${fit(launch.repoName, PROJECT_COLS)}`, tone: 'muted' },
  ], right, cols)] };
}

/** At most `max` needs-me rows in order; the current session always keeps a slot. */
function capRows(rows, currentID, max) {
  if (rows.length <= max) return rows;
  const shown = rows.slice(0, max);
  const current = rows.findIndex((r) => r.id === currentID);
  return current < max ? shown : [...shown.slice(0, max - 1), rows[current]];
}

const dimmed = (entry) => ({ ...entry, lines: entry.lines.map((parts) => parts.map((p) => ({ ...p, tone: 'muted' }))) });

/**
 * The Fleet section of the session sidebar (Option C of the sidebar redesign), prepended above
 * OpenCode's own sections: a "Fleet" title with the working/stuck counts, then one line per
 * entry: launches, then blocked (with the ask on a second line), then finished. The current
 * session reads `this session` behind a blue `▌`. At most `max` session rows, then `+N more`.
 *
 * Returns entries `{ key, action?, current?, lines: parts[][] }`; a part is `{ text, tone, bold?,
 * action? }`. An entry's `action` is what clicking it does (`open`, `undo`, `page`,
 * `launch-failed`); a part's `action` is a separate click target (`dismiss`, `page`).
 */
export function sidebarLines({ live, status, baseURL, now, currentID, lastHandled, pageKey, cols = SIDEBAR_COLS, max = SIDEBAR_ROWS }) {
  const label = statusLabel(status, live);
  const title = { text: 'Fleet', tone: 'base', bold: true };
  if (!live) {
    const host = baseURL.replace(/^https?:\/\//, '');
    return [
      { key: 'header', lines: [spread([title], [label], cols)] },
      { key: 'status', lines: [[{ text: fit(status === 'unreachable' ? `${host} · retrying…` : host, cols), tone: 'muted' }]] },
    ];
  }
  const board = buildBoard(live, now);
  const healthy = status === 'live' && live.connection === 'connected';
  const page = { type: 'page' };
  const entries = [{ key: 'header', lines: [spread([title], healthy ? countParts(board.counts, page) : [label], cols)] }];
  const body = [];
  if (lastHandled && now - lastHandled.at < UNDO_WINDOW) {
    body.push({ key: 'undo', action: { type: 'undo' }, lines: [spread([
      gutter(false), { text: '✓ Handled ', tone: 'muted' }, { text: lastHandled.title, tone: 'muted', cut: true },
      { text: ' · ', tone: 'muted' }, { text: 'undo', tone: 'base' },
    ], [], cols)] });
  }
  for (const launch of live.launches) body.push(launchEntry(launch, now, cols));
  const rows = capRows(board.needsMe, currentID, max);
  for (const row of rows) body.push(sessionEntry(live, row, now, row.id === currentID, cols));
  const more = board.needsMe.length - rows.length;
  if (more > 0) body.push({ key: 'more', action: page, lines: [[gutter(false), { text: fit(`+${more} more${pageKey ? ` · ${pageKey}` : ''}`, cols - 1), tone: 'muted' }]] });
  if (!board.needsMe.length) body.push({ key: 'empty', lines: [[{ text: 'Nothing needs you', tone: 'muted' }]] });
  // Unreachable, or Fleet lost OpenCode: the list is kept but may be stale.
  const stale = status === 'unreachable' || live.connection !== 'connected';
  return [...entries, ...(stale ? body.map(dimmed) : body)];
}

/**
 * Body lines of the page: needs me (blocked, then finished), then working with stuck labels.
 * Lines with `id` are selectable rows.
 */
export function pageLines({ live, status, baseURL, now, cols, selectedID, answer = () => undefined }) {
  if (!live) {
    return [{ parts: [{ text: status === 'unreachable' ? `Fleet unreachable at ${baseURL}` : `Connecting to ${baseURL}…`, tone: 'muted' }] }];
  }
  const board = buildBoard(live, now);
  const lines = [];
  const row = (r) => {
    const reason = rowReason(r, now, answer(r));
    // Working rows carry their live activity or stuck label instead of an age.
    const detail = [reason?.text, r.state === 'working' ? undefined : relativeTime(r.activeAt, now)].filter(Boolean).join(' · ');
    const selected = r.id === selectedID, mark = marker(r);
    lines.push({ id: r.id, selected, parts: [
      { text: selected ? '› ' : '  ', tone: 'current' },
      ...spread([{ text: `${mark.text} `, tone: mark.tone }, { text: rowLabel(live, r), tone: 'base' }],
        [{ text: fit(detail, Math.floor((cols - 2) / 2)), tone: reason?.tone === 'error' ? 'error' : 'muted' }], cols - 2),
    ] });
  };
  for (const [title, rows] of [['Blocked', board.blocked], ['Finished', board.finished], ['Working', board.working]]) {
    if (!rows.length) continue;
    if (lines.length) lines.push({ parts: [] });
    lines.push({ parts: [{ text: `${title} ${rows.length}`, tone: 'base', bold: true }] });
    for (const r of rows) row(r);
  }
  if (!lines.length) lines.push({ parts: [{ text: 'Nothing needs you; no session is working.', tone: 'muted' }] });
  return lines;
}

export const selectableIDs = (lines) => lines.filter((l) => l.id).map((l) => l.id);

/** First visible line so the selected line stays in a window of `height` lines. */
export function scrollTop(previous, selectedIndex, total, height) {
  if (height <= 0 || total <= height) return 0;
  let top = Math.min(Math.max(0, previous), total - height);
  if (selectedIndex >= 0 && selectedIndex < top) top = Math.max(0, selectedIndex - 1);
  if (selectedIndex >= top + height) top = selectedIndex - height + 1;
  return top;
}

/** Hyperscript over the injected Solid universal runtime; function props/children are reactive. */
export function createH(r) {
  return function h(tag, props, ...children) {
    if (typeof tag === 'function') return r.createComponent(tag, { ...props, children });
    const node = r.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
      if (value === undefined) continue;
      if (typeof value === 'function' && !key.startsWith('on')) r.effect((prev) => r.setProp(node, key, value(), prev));
      else r.setProp(node, key, value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) r.insert(node, child, null);
    return node;
  };
}

/** Opens an http(s) URL with the OS opener; resolves false when unavailable. */
export function openURL(url, { platform = process.platform, run = spawn } = {}) {
  if (typeof url !== 'string' || !/^https?:\/\/[^\s]+$/.test(url)) return Promise.resolve(false);
  const command = platform === 'darwin' ? 'open' : platform === 'linux' ? 'xdg-open' : undefined;
  if (!command) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const child = run(command, [url], { detached: true, stdio: 'ignore' });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch { resolve(false); }
  });
}

/** Batches transitions into one notification after `delay`, skipping repeats within `quiet`. */
export function createNotifier({ send, live, timers = globalThis, now = Date.now, delay = 1500, quiet = 60_000 }) {
  let pending = [], timer;
  const recent = new Map();
  return {
    push(batch) {
      for (const [key, at] of recent) if (now() - at >= quiet) recent.delete(key);
      const fresh = batch.filter((t) => {
        const key = `${t.row.id}:${t.kind}`;
        const at = recent.get(key);
        if (at !== undefined && now() - at < quiet) return false;
        recent.set(key, now());
        return true;
      });
      if (!fresh.length) return;
      pending.push(...fresh);
      timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        const batchNow = pending; pending = []; timer = undefined;
        const message = notification(live(), batchNow);
        if (message) send(message);
      }, delay);
    },
    stop() { timers.clearTimeout(timer); timer = undefined; pending = []; },
  };
}

/**
 * Answer excerpts for finished rows, fetched lazily from Fleet's per-run summary route (Fleet
 * caches it by run), at most `concurrency` at a time; a failed lookup is not retried for that run.
 */
export function createAnswers({ api, onChange, concurrency = 2, max = 200 }) {
  const cache = new Map();
  let inflight = 0, stopped = false;
  const key = (row) => `${row.id}:${row.idle}`;
  return {
    get: (row) => { const value = cache.get(key(row)); return typeof value === 'string' ? value : undefined; },
    want(rows) {
      for (const row of rows) {
        if (stopped || inflight >= concurrency) return;
        if (row.state !== 'finished' || row.outcome === 'failed' || row.outcome === 'interrupted' || row.idle === undefined || cache.has(key(row))) continue;
        const k = key(row);
        cache.set(k, null);
        inflight += 1;
        void api.summary(row.id, row.idle).then((result) => {
          inflight -= 1;
          if (stopped) return;
          cache.set(k, result.ok && result.value.answer ? result.value.answer : null);
          while (cache.size > max) cache.delete(cache.keys().next().value);
          onChange();
        });
      }
    },
    stop() { stopped = true; },
  };
}

const routeOf = (route) => ({ ...route, ...(route.data ? { data: { ...route.data } } : {}) });

/**
 * Wires the plugin into the host. `runtime`: OpenTUI Solid (`createElement`, `insert`, `setProp`,
 * `effect`, `createComponent`, `useTerminalDimensions`) plus Solid's `createSignal`.
 */
export function setupFleet(ctx, runtime, deps = {}) {
  const env = deps.env ?? process.env;
  const clock = deps.now ?? Date.now;
  const timers = deps.timers ?? globalThis;
  const baseURL = resolveBaseURL(ctx.options?.url, env.FLEET_URL);
  const mode = notifyMode(ctx.options?.notify);
  const keys = resolveKeys(ctx.options?.keys);
  const lifetime = new AbortController();
  const alive = () => !lifetime.signal.aborted;
  const api = createFleetApi({ baseURL, fetch: deps.fetch, timers, signal: lifetime.signal });
  const h = createH(runtime);
  const [version, setVersion] = runtime.createSignal(0);
  const [tick, setTick] = runtime.createSignal(0);
  const [clockTick, setClockTick] = runtime.createSignal(0);
  const [selected, setSelected] = runtime.createSignal(undefined);
  // The sidebar entry under the mouse (one band at a time), and the click target under it.
  const [hovered, setHovered] = runtime.createSignal(undefined);
  const [hoveredTarget, setHoveredTarget] = runtime.createSignal(undefined);
  const bump = () => setVersion((v) => v + 1);
  const overrides = new Map(), busy = new Set();
  let previousRoute = { type: 'home' }, top = 0, lastLive, lastHandled, launchClock;

  const live = () => withOverrides(source.live, overrides);
  const wantAnswers = () => { if (source.live) answers.want(buildBoard(source.live, clock()).finished); };
  const answers = createAnswers({ api, onChange: () => { bump(); wantAnswers(); } });
  const toast = (variant, message) => { if (alive()) ctx.ui.toast.show({ variant, message }); };
  const shortcut = (id, key) => ctx.keymap.shortcuts?.(id)?.[0] ?? (key ? key.replace('<leader>', 'ctrl+x ') : undefined);

  const openSession = (sessionID) => {
    ctx.ui.dialog.clear();
    // The session route loads the session by ID and switches location to its directory.
    ctx.ui.router.navigate({ type: 'session', sessionID });
  };
  const watch = createLaunchWatch({ ctx, openSession });

  const notifier = createNotifier({
    timers, now: clock,
    live: () => source.live,
    send: (message) => {
      void Promise.resolve()
        .then(() => ctx.attention.notify({ ...message, notification: { when: 'blurred' }, sound: false }))
        .catch(() => {});
    },
  });
  // Ticks every second while a launch is in progress, for its elapsed clock.
  const syncLaunchClock = () => {
    const running = alive() && (source.live?.launches.some(launchRunning) ?? false);
    if (running && launchClock === undefined) launchClock = timers.setInterval(() => setClockTick((v) => v + 1), 1000);
    if (!running && launchClock !== undefined) { timers.clearInterval(launchClock); launchClock = undefined; }
  };
  const source = createFleetSource({
    baseURL, fetch: deps.fetch, timers,
    onUpdate: ({ live: next, reason }) => {
      // Baseline: the first data never notifies; afterwards every model update is diffed.
      if (reason !== 'status' && lastLive) notifier.push(transitions(lastLive, next, mode));
      if (reason !== 'status') lastLive = next;
      wantAnswers();
      watch.check(next);
      syncLaunchClock();
      bump();
    },
  });

  const currentRoot = () => {
    const route = ctx.ui.router.current();
    return route.type === 'session' ? ctx.data.session.root(route.sessionID) : undefined;
  };
  const unavailable = () => {
    if (source.live && source.status !== 'unreachable') return false;
    toast('error', `Fleet unavailable (${baseURL})`);
    return true;
  };
  const undoHint = () => { const s = shortcut('fleet.undo', keys.undo); return s ? ` · ${s} to undo` : ''; };

  /** Marks a finished root session handled (optimistically, like the web), then offers undo. */
  const markHandled = async (rowID) => {
    if (unavailable()) return;
    if (rowID === undefined) return toast('info', 'Open a finished session first');
    const row = source.live.rows.get(rowID);
    if (!row || live().rows.get(row.id)?.state !== 'finished') return toast('info', 'Only a finished session can be marked handled');
    if (busy.has(row.id)) return;
    busy.add(row.id);
    overrides.set(row.id, { base: row, target: 'handled' });
    bump();
    const result = await api.handled(row.id);
    busy.delete(row.id);
    if (!alive()) return;
    if (!result.ok) {
      if (overrides.get(row.id)?.base === row) overrides.delete(row.id);
      bump();
      return toast('error', `Could not mark handled: ${result.error}`);
    }
    lastHandled = { id: row.id, title: titleOf(row), at: clock() };
    bump();
    toast('success', `Handled ${titleOf(row)}${undoHint()}`);
  };

  /** Reopens the last session handled here (removes Fleet's handled marker). */
  const undo = async () => {
    const last = lastHandled;
    if (!last) return toast('info', 'Nothing to undo');
    if (busy.has(last.id)) return;
    busy.add(last.id);
    const base = source.live?.rows.get(last.id);
    if (base) overrides.set(last.id, { base, target: 'finished' });
    lastHandled = undefined;
    bump();
    const result = await api.reopen(last.id);
    busy.delete(last.id);
    if (!alive()) return;
    if (!result.ok) {
      if (base && overrides.get(last.id)?.base === base) overrides.delete(last.id);
      lastHandled = last;
      bump();
      return toast('error', `Could not reopen: ${result.error}`);
    }
    toast('info', result.value.outcome === 'not-handled' ? `${last.title} was not handled` : `Reopened ${last.title}`);
  };

  const dismiss = async (launchID) => {
    const result = await api.dismiss(launchID);
    if (!result.ok) toast('error', `Could not dismiss: ${result.error}`);
  };

  let launching = false;
  const launcher = async () => {
    if (launching) return;
    launching = true;
    try {
      await runLauncher({ ctx, api, openSession, alive, onLaunched: (launch) => { watch.start(launch); watch.check(source.live); } });
    } catch { toast('error', 'Fleet launcher failed'); } finally { launching = false; }
  };

  const openPage = () => {
    const current = ctx.ui.router.current();
    ctx.ui.dialog.clear();
    if (current.type === 'plugin' && current.name === ROUTE) return;
    previousRoute = routeOf(current);
    ctx.ui.router.navigate({ type: 'plugin', name: ROUTE });
  };
  const back = () => ctx.ui.router.navigate(previousRoute.type === 'plugin' && previousRoute.name === ROUTE ? { type: 'home' } : previousRoute);
  const nextSession = () => {
    if (unavailable()) return;
    const target = nextNeedsMe(buildBoard(live(), clock()).needsMe, currentRoot());
    if (!target) return toast('info', 'Nothing needs you');
    openSession(target.id);
  };

  const theme = () => ctx.theme;
  // Green is Fleet's "needs you", red a failure, blue where you are or what is running; never
  // OpenCode's warning/accent (orange in most themes).
  const TONES = {
    base: (t) => t.text.base, muted: (t) => t.text.muted, error: (t) => t.text.feedback.error.base,
    attention: (t) => t.text.feedback.success.base, current: (t) => t.text.formfield.selected, running: (t) => t.hue.interactive[200],
  };
  const tone = (name) => (TONES[name] ?? TONES.base)(theme());
  const span = (part, muted) => h('span', { style: { fg: tone(muted ? 'muted' : part.tone), ...(part.bold ? { bold: true } : {}) } }, part.text);
  const textLine = (parts, muted = false) => h('text', { wrapMode: 'none', selectable: false }, ...parts.map((p) => span(p, muted)));

  const badge = () => {
    version(); tick();
    const view = badgeView(source.status, live(), clock());
    if (!view.visible) return null;
    const parts = [{ text: `${BADGE_MARK} `, tone: view.parts[0].kind === 'need' ? 'attention' : 'muted' }];
    view.parts.forEach((p, i) => {
      if (i) parts.push({ text: ' · ', tone: 'muted' });
      parts.push({ text: p.text, tone: BADGE_TONES[p.kind] });
    });
    return h('box', { flexShrink: 0, onMouseUp: openPage }, textLine(parts, view.subtle));
  };

  const runAction = (action) => {
    if (action.type === 'open') openSession(action.sessionID);
    else if (action.type === 'dismiss') void dismiss(action.launchID);
    else if (action.type === 'undo') void undo();
    else if (action.type === 'page') openPage();
    else if (action.type === 'launch-failed') {
      const { launch } = action;
      toast('error', `Launch of ${launch.branch} failed: ${launch.error ?? 'unknown error'}${launch.preserved ? ` (kept: ${launch.preserved})` : ''}`);
    }
  };

  /** Consecutive parts sharing one click target (or none) render as one text. */
  const segments = (parts) => parts.reduce((all, part) => {
    const last = all.at(-1);
    if (last && last.action === part.action) last.parts.push(part);
    else all.push({ action: part.action, parts: [part] });
    return all;
  }, []);
  /** A separate click target inside an entry (`✕`, the counts): muted turns base on hover. */
  const target = (key, segment) => h('text', {
    wrapMode: 'none', selectable: false, flexShrink: 0,
    onMouseOver: () => setHoveredTarget(key),
    onMouseOut: () => setHoveredTarget((k) => (k === key ? undefined : k)),
    onMouseUp: (event) => { event?.stopPropagation?.(); runAction(segment.action); },
  }, () => segment.parts.map((p) => span(hoveredTarget() === key && p.tone === 'muted' ? { ...p, tone: 'base' } : p)));
  const lineBox = (entryKey) => (parts, row) => h('box', { flexDirection: 'row', height: 1, flexShrink: 0 },
    ...segments(parts).map((segment, i) => (segment.action
      ? target(`${entryKey}:${row}:${i}`, segment)
      : h('text', { wrapMode: 'none', selectable: false, flexShrink: 0 }, ...segment.parts.map((p) => span(p))))));
  /** One box per entry, so the hover band covers every line of it. */
  const entryBox = (entry) => h('box', {
    flexDirection: 'column', flexShrink: 0,
    ...(entry.action ? {
      backgroundColor: () => (hovered() === entry.key ? theme().background.raised.high : undefined),
      onMouseOver: () => setHovered(entry.key),
      onMouseOut: () => setHovered((k) => (k === entry.key ? undefined : k)),
      onMouseUp: () => runAction(entry.action),
    } : {}),
  }, ...entry.lines.map(lineBox(entry.key)));

  /**
   * The Fleet section, prepended inside `sidebar.content`: OpenCode's own sections (Context, MCP,
   * LSP, todos) stay below it, and the slot's `gap={1}` puts one blank row between them.
   */
  function FleetSidebar(input) {
    return h('box', { flexDirection: 'column', flexShrink: 0 }, () => {
      version(); tick(); clockTick();
      const current = input.sessionID ? ctx.data.session.root(input.sessionID) : undefined;
      return sidebarLines({
        live: live(), status: source.status, baseURL, now: clock(), currentID: current, lastHandled,
        pageKey: shortcut('fleet.open', keys.open),
      }).map(entryBox);
    });
  }

  function FleetPage() {
    const dimensions = runtime.useTerminalDimensions();
    const cols = () => Math.max(20, dimensions().width - 4);
    const linesFor = (selectedID) => pageLines({ live: live(), status: source.status, baseURL, now: clock(), cols: cols(), selectedID, answer: answers.get });
    const currentSelection = () => {
      version();
      const ids = selectableIDs(linesFor(undefined));
      const id = selected();
      return ids.includes(id) ? id : ids[0];
    };
    const lines = () => { version(); tick(); return linesFor(currentSelection()); };
    const move = (delta) => {
      const ids = selectableIDs(lines());
      if (!ids.length) return;
      const index = Math.max(0, ids.indexOf(currentSelection()));
      setSelected(ids[Math.min(ids.length - 1, Math.max(0, index + delta))]);
    };
    const row = () => live()?.rows.get(currentSelection());
    ctx.keymap.layer(() => ({ commands: [
      { bind: 'escape,q', title: 'Back', group: 'Fleet', run: back },
      { bind: 'down,j', title: 'Next session', group: 'Fleet', run: () => move(1) },
      { bind: 'up,k', title: 'Previous session', group: 'Fleet', run: () => move(-1) },
      { bind: 'return', title: 'Open session', group: 'Fleet', run: () => { const r = row(); if (r) openSession(r.id); } },
      { bind: 'h', title: 'Mark handled', group: 'Fleet', run: () => { const r = row(); if (r) void markHandled(r.id); } },
      { bind: 'o', title: 'Open in web', group: 'Fleet', run: () => {
        const r = row();
        if (!r?.web) return;
        void (deps.openURL ?? openURL)(r.web).then((ok) => { if (!ok) toast('info', 'No URL opener here; use the Fleet web view'); }, () => {});
      } },
    ] }));
    const header = () => {
      version();
      const status = statusLabel(source.status, source.live);
      return textLine(spread([{ text: 'Fleet', tone: 'base', bold: true }], [status], cols()));
    };
    const body = () => {
      const all = lines();
      const height = Math.max(1, dimensions().height - 5);
      const index = all.findIndex((l) => l.selected);
      top = scrollTop(top, index, all.length, height);
      return all.slice(top, top + height).map((line) => h('box', {
        height: 1, flexShrink: 0, ...(line.selected ? { backgroundColor: theme().background.raised.high } : {}),
      }, textLine(line.parts)));
    };
    return h('box', {
      width: () => dimensions().width, height: () => dimensions().height, flexDirection: 'column',
      backgroundColor: () => theme().background.base, paddingLeft: 2, paddingRight: 2, paddingTop: 1,
    },
    h('box', { height: 1, flexShrink: 0 }, header),
    h('box', { height: 1, flexShrink: 0 }),
    h('box', { flexGrow: 1, flexDirection: 'column' }, body),
    h('box', { height: 1, flexShrink: 0 }, () => textLine([{ text: 'j/k select · enter open · h handled · o web · esc back', tone: 'muted' }])));
  }

  // Global leader commands (also in the palette): OpenCode 2.0.20's sidebar cannot take keyboard
  // focus, so Fleet's keys cannot live inside it. CLI plugins must create layers inside a slot.
  function Commands() {
    ctx.keymap.layer(() => ({ mode: 'global', commands: [
      { id: 'fleet.open', title: 'Fleet', description: 'Needs-me and working sessions (Fleet)', group: 'Fleet', bind: keys.open, palette: true, slash: { name: 'fleet' }, run: openPage },
      { id: 'fleet.next', title: 'Fleet: Next needs-me session', description: 'Jump to the next session waiting on you', group: 'Fleet', bind: keys.next, palette: true, run: nextSession },
      { id: 'fleet.launcher', title: 'Fleet: New / open', description: 'Open a repository or worktree, or start a new worktree', group: 'Fleet', bind: keys.launcher, palette: true, run: launcher },
      { id: 'fleet.handled', title: 'Fleet: Mark handled', description: "Mark this finished session's latest run handled", group: 'Fleet', bind: keys.handled, palette: true, run: () => markHandled(currentRoot()) },
      { id: 'fleet.undo', title: 'Fleet: Undo handled', description: 'Reopen the last session marked handled here', group: 'Fleet', bind: keys.undo, palette: true, run: undo },
    ] }));
    return null;
  }

  const cleanups = [
    ctx.ui.router.register({ name: ROUTE, render: () => runtime.createComponent(FleetPage, {}) }),
    ctx.ui.slot({ append: 'app', render: () => runtime.createComponent(Commands, {}) }),
    // Prepend, not replace: OpenCode's Context/MCP/LSP/todos (all `append` claims) stay below.
    ctx.ui.slot({ prepend: 'sidebar.content', render: (input) => runtime.createComponent(FleetSidebar, input) }),
    ctx.ui.slot({ append: 'home.footer.status', render: () => badge }),
    // The home route has a prompt too; its footer badge would repeat the home footer's.
    ctx.ui.slot({ append: 'prompt.footer.status', render: (input) => () => (input.sessionID ? badge() : null) }),
  ];
  const interval = timers.setInterval(() => setTick((v) => v + 1), 30_000);
  source.start();
  return () => {
    lifetime.abort();
    timers.clearInterval(interval);
    if (launchClock !== undefined) timers.clearInterval(launchClock);
    launchClock = undefined;
    notifier.stop();
    answers.stop();
    watch.stop();
    source.stop();
    for (const cleanup of cleanups.reverse()) { try { cleanup?.(); } catch { /* host already removed it */ } }
  };
}
