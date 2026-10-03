// Fleet terminal view: focus sidebar, footer badge, full-page route, commands, handled/undo,
// launcher and notifications. The OpenTUI Solid runtime is injected (see tui.js), so this module
// builds elements without a JSX build step and runs under node --test with a fake runtime.
import { spawn } from 'node:child_process';
import {
  BADGE_MARK, badgeView, buildBoard, elapsedText, launchRunning, launchStatusText, nextNeedsMe, notification, notifyMode,
  placeLabel, relativeTime, resolveBaseURL, resolveKeys, rowLabel, rowReason, titleOf, transitions, withOverrides,
} from './fleet.js';
import { createFleetApi } from './api.js';
import { createLaunchWatch, runLauncher } from './launcher.js';
import { createFleetSource } from './source.js';

export const ROUTE = 'fleet';
/** OpenCode's session sidebar is 42 columns with 2+2 padding and 1 column kept for its scrollbar. */
export const SIDEBAR_COLS = 37;
/** The sidebar offers undo for this long after a handled. */
export const UNDO_WINDOW = 5 * 60 * 1000;

const MARKER = {
  blocked: { text: '■', tone: 'warning' }, working: { text: '◧', tone: 'base' },
  finished: { text: '▪', tone: 'base' }, handled: { text: '□', tone: 'muted' },
};
const marker = (row) => row.state === 'finished' && row.outcome === 'failed' ? { text: '▪', tone: 'error' } : MARKER[row.state];
const LAUNCH_MARKER = {
  provisioning: { text: '◌', tone: 'info' }, 'creating-session': { text: '◌', tone: 'info' },
  ready: { text: '■', tone: 'success' }, failed: { text: '✕', tone: 'error' },
};

const width = (text) => [...text].length;
export function fit(text, max) {
  if (max <= 0) return '';
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

/** One line: `left` parts truncated (last part first) so `right` fits flush right in `cols`. */
function spread(left, right, cols, tone = 'muted') {
  const room = cols - (right ? width(right) + 1 : 0);
  const parts = [];
  let used = 0;
  for (const part of left) {
    const text = fit(part.text, room - used);
    parts.push({ ...part, text });
    used += width(text);
  }
  if (right) parts.push({ text: `${' '.repeat(Math.max(1, cols - used - width(right)))}${right}`, tone });
  return parts;
}

/** Header status label. */
export function statusLabel(status, live) {
  if (status === 'unreachable') return { text: 'unreachable', tone: 'error' };
  if (live && live.connection !== 'connected') return { text: 'Fleet lost OpenCode', tone: 'warning' };
  if (status === 'live') return { text: 'live', tone: 'success' };
  return { text: status === 'reconnecting' ? 'reconnecting…' : 'connecting…', tone: 'muted' };
}

const countsText = (counts) => counts.working
  ? `${counts.working} working${counts.stuck ? ` · ${counts.stuck} stuck` : ''}` : 'Nothing is working';

/**
 * The focus sidebar's lines (DESIGN.md "Clients" → Terminal): launches, then the needs-me list
 * (blocked, then finished), the current session highlighted; "Nothing needs you" plus the
 * working/stuck counts when empty. Each line is `{ parts: [{ text, tone, bold? }], selected?,
 * action? }`; `action` (`open` / `dismiss` / `undo`) is what a click does.
 */
export function sidebarLines({ live, status, baseURL, now, currentID, lastHandled, answer = () => undefined, hints = [], cols = SIDEBAR_COLS }) {
  const label = statusLabel(status, live);
  const header = { parts: spread([{ text: 'Fleet', tone: 'base', bold: true }], !live || label.text === 'live' ? '' : label.text, cols, label.tone) };
  if (!live) {
    return [header, { parts: [] },
      { parts: [{ text: status === 'unreachable' ? 'Fleet unreachable' : 'Connecting to Fleet…', tone: 'muted' }] },
      { parts: [{ text: fit(baseURL, cols), tone: 'muted' }] }];
  }
  const lines = [header];
  if (lastHandled && now - lastHandled.at < UNDO_WINDOW) {
    lines.push({ action: { type: 'undo' }, parts: [
      { text: '✓ ', tone: 'success' }, { text: fit(`handled ${lastHandled.title}`, cols - 9), tone: 'muted' }, { text: ' · undo', tone: 'info' },
    ] });
  }
  if (live.launches.length) {
    lines.push({ parts: [] }, { parts: [{ text: `LAUNCHES  ${live.launches.length}`, tone: 'info', bold: true }] });
    for (const launch of live.launches) {
      const open = launch.status === 'ready' && launch.sessionID ? { type: 'open', sessionID: launch.sessionID } : undefined;
      const elapsed = elapsedText((launchRunning(launch) ? Math.max(now, launch.updatedAt) : launch.updatedAt) - launch.startedAt);
      const mark = LAUNCH_MARKER[launch.status];
      const failed = launch.status === 'failed';
      lines.push({ action: open, parts: spread([{ text: `${mark.text} `, tone: mark.tone }, { text: `${launch.branch} · ${launch.repoName}`, tone: 'base' }], elapsed, cols) });
      lines.push({ action: open, parts: [{ text: fit(`  ${failed ? `failed: ${launch.error ?? 'unknown error'}` : launchStatusText(launch)}`, cols), tone: failed ? 'error' : open ? 'success' : 'muted' }] });
      if (launchRunning(launch)) lines.push({ parts: [{ text: fit(`  ${launch.task}`, cols), tone: 'muted' }] });
      else {
        if (failed && launch.preserved) lines.push({ parts: [{ text: fit(`  kept: ${launch.preserved}`, cols), tone: 'muted' }] });
        lines.push({ action: { type: 'dismiss', launchID: launch.id }, parts: [{ text: '  × dismiss', tone: 'muted' }] });
      }
    }
  }
  const board = buildBoard(live, now);
  for (const [name, rows, tone] of [['BLOCKED', board.blocked, 'warning'], ['FINISHED', board.finished, 'base']]) {
    if (!rows.length) continue;
    lines.push({ parts: [] }, { parts: [{ text: `${name}  ${rows.length}`, tone, bold: true }] });
    for (const row of rows) {
      const selected = row.id === currentID, action = { type: 'open', sessionID: row.id }, mark = marker(row);
      lines.push({ selected, action, parts: spread([{ text: `${mark.text} `, tone: mark.tone }, { text: placeLabel(live, row), tone: 'muted' }], relativeTime(row.activeAt, now), cols) });
      lines.push({ selected, action, parts: [{ text: fit(`  ${titleOf(row)}`, cols), tone: 'base', bold: selected }] });
      const reason = rowReason(row, now, answer(row));
      if (reason) lines.push({ selected, action, parts: [{ text: fit(`  ${reason.text}`, cols), tone: reason.tone }] });
    }
  }
  lines.push({ parts: [] });
  if (!board.needsMe.length) lines.push({ parts: [{ text: 'Nothing needs you', tone: 'base' }] });
  lines.push({ parts: [{ text: countsText(board.counts), tone: board.counts.stuck ? 'error' : 'muted' }] });
  if (hints.length) lines.push({ parts: [] }, ...hints.map((hint) => ({ parts: [{ text: fit(hint, cols), tone: 'muted' }] })));
  return lines;
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
      { text: selected ? '› ' : '  ', tone: 'info' },
      ...spread([{ text: `${mark.text} `, tone: mark.tone }, { text: rowLabel(live, r), tone: 'base' }], fit(detail, Math.floor((cols - 2) / 2)), cols - 2,
        reason?.tone === 'error' ? 'error' : 'muted'),
    ] });
  };
  for (const [title, rows, tone] of [['BLOCKED', board.blocked, 'warning'], ['FINISHED', board.finished, 'base'], ['WORKING', board.working, 'info']]) {
    if (!rows.length) continue;
    if (lines.length) lines.push({ parts: [] });
    lines.push({ parts: [{ text: `${title}  ${rows.length}`, tone, bold: true }] });
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
    toast('warning', `Fleet unavailable (${baseURL})`);
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
  const tone = (name) => {
    const t = theme();
    return {
      base: t.text.base, muted: t.text.muted, info: t.text.feedback.info.base,
      warning: t.text.feedback.warning.base, error: t.text.feedback.error.base, success: t.text.feedback.success.base,
    }[name] ?? t.text.base;
  };
  const span = (part, muted) => h('span', { style: { fg: tone(muted ? 'muted' : part.tone), ...(part.bold ? { bold: true } : {}) } }, part.text);
  const textLine = (parts, muted = false) => h('text', { wrapMode: 'none', selectable: false }, ...parts.map((p) => span(p, muted)));

  const badge = () => {
    version(); tick();
    const view = badgeView(source.status, live(), clock());
    if (!view.visible) return null;
    const parts = [{ text: `${BADGE_MARK} `, tone: view.parts[0].kind === 'need' ? 'warning' : 'muted' }];
    view.parts.forEach((p, i) => {
      if (i) parts.push({ text: ' · ', tone: 'muted' });
      parts.push({ text: p.text, tone: { need: 'warning', working: 'base', stuck: 'error' }[p.kind] });
    });
    return h('box', { flexShrink: 0, onMouseUp: openPage }, textLine(parts, view.subtle));
  };

  const runAction = (action) => {
    if (action.type === 'open') openSession(action.sessionID);
    else if (action.type === 'dismiss') void dismiss(action.launchID);
    else if (action.type === 'undo') void undo();
  };
  const hints = () => [
    [['fleet.next', keys.next, 'next'], ['fleet.handled', keys.handled, 'handled']],
    [['fleet.undo', keys.undo, 'undo'], ['fleet.launcher', keys.launcher, 'new']],
  ].map((pair) => pair.flatMap(([id, key, label]) => { const s = shortcut(id, key); return s ? [`${s} ${label}`] : []; }).join(' · ')).filter(Boolean);

  /** `sidebar.content` replacement; OpenCode's sidebar keeps its title and footer around it. */
  function FleetSidebar(input) {
    return h('box', { flexDirection: 'column', flexShrink: 0 }, () => {
      version(); tick(); clockTick();
      const current = input.sessionID ? ctx.data.session.root(input.sessionID) : undefined;
      const lines = sidebarLines({
        live: live(), status: source.status, baseURL, now: clock(), currentID: current, lastHandled,
        answer: answers.get, hints: hints(),
      });
      return lines.map((line) => h('box', {
        height: 1, flexShrink: 0, ...(line.selected ? { backgroundColor: theme().background.raised.high } : {}),
        ...(line.action ? { onMouseUp: () => runAction(line.action) } : {}),
      }, textLine(line.parts)));
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
      return textLine(spread([{ text: 'Fleet', tone: 'base', bold: true }], status.text, cols(), status.tone));
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
    ctx.ui.slot({ replace: 'sidebar.content', render: (input) => runtime.createComponent(FleetSidebar, input) }),
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
