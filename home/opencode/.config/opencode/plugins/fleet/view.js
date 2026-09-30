// Fleet terminal view: footer badge, full-page route, commands and notifications. The OpenTUI
// Solid runtime is injected (see tui.js), so this module builds elements without a JSX build
// step and runs under node --test with a fake runtime.
import { spawn } from 'node:child_process';
import {
  BADGE_MARK, badgeView, buildBoard, notification, nextNeedsYou, notifyMode, resolveBaseURL, rowDetail,
  rowLabel, transitions,
} from './fleet.js';
import { createFleetSource } from './source.js';

export const ROUTE = 'fleet';
export const KEYS = { open: '<leader>f', next: '<leader>j' };

const SECTION = {
  'needs-you': { title: 'NEEDS YOU', tone: 'warning' },
  failed: { title: 'FAILED', tone: 'error' },
  working: { title: 'WORKING', tone: 'info' },
  done: { title: 'DONE', tone: 'success' },
  idle: { title: 'IDLE', tone: 'muted' },
};

const width = (text) => [...text].length;
export function fit(text, max) {
  if (max <= 0) return '';
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

/** Header status label for the page. */
export function statusLabel(status, live) {
  if (status === 'unreachable') return { text: 'unreachable', tone: 'error' };
  if (live && live.connection !== 'connected') return { text: 'Fleet lost OpenCode', tone: 'warning' };
  if (status === 'live') return { text: 'live', tone: 'success' };
  return { text: status === 'reconnecting' ? 'reconnecting…' : 'connecting…', tone: 'muted' };
}

/**
 * Body lines of the page (before scrolling): section headers and rows, state-first. Each line is
 * `{ id?, parts: [{ text, tone, bold? }] }`; lines with `id` are selectable rows.
 */
export function pageLines({ live, status, baseURL, now, cols, selectedID, showIdle }) {
  if (!live) {
    return [{ parts: [{ text: status === 'unreachable' ? `Fleet unreachable at ${baseURL}` : `Connecting to ${baseURL}…`, tone: 'muted' }] }];
  }
  const board = buildBoard(live, now);
  const lines = [];
  const row = (r, idle) => {
    const detail = rowDetail(r, now);
    const room = cols - 2 - (detail ? width(detail) + 2 : 0);
    const label = fit(rowLabel(live, r), room);
    const gap = ' '.repeat(Math.max(1, cols - 2 - width(label) - width(detail)));
    const selected = r.id === selectedID;
    lines.push({ id: r.id, selected, parts: [
      { text: selected ? '› ' : '  ', tone: 'accent' },
      { text: label, tone: idle && !selected ? 'muted' : 'base' },
      { text: detail ? `${gap}${detail}` : '', tone: 'muted' },
    ] });
  };
  for (const section of board.sections) {
    if (lines.length) lines.push({ parts: [] });
    lines.push({ parts: [{ text: `${SECTION[section.state].title}  ${section.rows.length}`, tone: SECTION[section.state].tone, bold: true }] });
    for (const r of section.rows) row(r, false);
  }
  if (!board.sections.length) lines.push({ parts: [{ text: 'Nothing needs you; no session is working or unseen.', tone: 'muted' }] });
  if (board.idle.length) {
    lines.push({ parts: [] });
    lines.push({ parts: [
      { text: `${SECTION.idle.title}  ${board.idle.length}`, tone: 'muted', bold: true },
      { text: showIdle ? '  i to collapse' : '  i to expand', tone: 'muted' },
    ] });
    if (showIdle) for (const r of board.idle) row(r, true);
  }
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
 * Wires the plugin into the host. `runtime`: OpenTUI Solid (`createElement`, `insert`, `setProp`,
 * `effect`, `createComponent`, `useTerminalDimensions`) plus Solid's `createSignal`.
 */
export function setupFleet(ctx, runtime, deps = {}) {
  const env = deps.env ?? process.env;
  const clock = deps.now ?? Date.now;
  const timers = deps.timers ?? globalThis;
  const baseURL = resolveBaseURL(ctx.options?.url, env.FLEET_URL);
  const mode = notifyMode(ctx.options?.notify);
  const h = createH(runtime);
  const [version, setVersion] = runtime.createSignal(0);
  const [tick, setTick] = runtime.createSignal(0);
  const [selected, setSelected] = runtime.createSignal(undefined);
  const [showIdle, setShowIdle] = runtime.createSignal(false);
  let previousRoute = { type: 'home' }, top = 0, lastLive;

  const notifier = createNotifier({
    timers, now: clock,
    live: () => source.live,
    send: (message) => {
      void Promise.resolve()
        .then(() => ctx.attention.notify({ ...message, notification: { when: 'blurred' }, sound: false }))
        .catch(() => {});
    },
  });
  const source = createFleetSource({
    baseURL, fetch: deps.fetch, timers,
    onUpdate: ({ live, reason }) => {
      // Baseline: the first data never notifies; afterwards every model update is diffed.
      if (reason !== 'status' && lastLive) notifier.push(transitions(lastLive, live, mode));
      if (reason !== 'status') lastLive = live;
      setVersion((v) => v + 1);
    },
  });

  const theme = () => ctx.theme;
  const tone = (name) => {
    const t = theme();
    return {
      base: t.text.base, muted: t.text.muted, accent: t.text.feedback.info.base, info: t.text.feedback.info.base,
      warning: t.text.feedback.warning.base, error: t.text.feedback.error.base, success: t.text.feedback.success.base,
    }[name] ?? t.text.base;
  };
  const span = (part, muted) => h('span', { style: { fg: tone(muted ? 'muted' : part.tone), ...(part.bold ? { bold: true } : {}) } }, part.text);

  const openSession = (sessionID) => {
    ctx.ui.dialog.clear();
    // The session route loads the session by ID and switches location to its directory.
    ctx.ui.router.navigate({ type: 'session', sessionID });
  };
  const openPage = () => {
    const current = ctx.ui.router.current();
    ctx.ui.dialog.clear();
    if (current.type === 'plugin' && current.name === ROUTE) return;
    previousRoute = { ...current, ...(current.data ? { data: { ...current.data } } : {}) };
    ctx.ui.router.navigate({ type: 'plugin', name: ROUTE });
  };
  const back = () => ctx.ui.router.navigate(previousRoute.type === 'plugin' && previousRoute.name === ROUTE ? { type: 'home' } : previousRoute);
  const nextSession = () => {
    const live = source.live;
    if (!live || source.status === 'unreachable') return ctx.ui.toast.show({ variant: 'warning', message: `Fleet unavailable (${baseURL})` });
    const route = ctx.ui.router.current();
    const root = route.type === 'session' ? ctx.data.session.root(route.sessionID) : undefined;
    const target = nextNeedsYou(buildBoard(live, clock()), root);
    if (!target) return ctx.ui.toast.show({ variant: 'info', message: 'Nothing needs you' });
    openSession(target.id);
  };

  const badge = () => {
    version(); tick();
    const view = badgeView(source.status, source.live, clock());
    if (!view.visible) return null;
    const parts = [{ text: `${BADGE_MARK} `, tone: view.parts[0].state === 'needs-you' ? 'warning' : 'muted' }];
    view.parts.forEach((p, i) => {
      if (i) parts.push({ text: ' · ', tone: 'muted' });
      parts.push({ text: p.text, tone: { 'needs-you': 'warning', failed: 'error', working: 'base', done: 'success' }[p.state] });
    });
    return h('box', { flexShrink: 0, onMouseUp: openPage }, h('text', { wrapMode: 'none', selectable: false }, ...parts.map((p) => span(p, view.subtle))));
  };

  function FleetPage() {
    const dimensions = runtime.useTerminalDimensions();
    const lines = () => {
      version(); tick();
      return pageLines({ live: source.live, status: source.status, baseURL, now: clock(), cols: Math.max(20, dimensions().width - 4), selectedID: currentSelection(), showIdle: showIdle() });
    };
    const currentSelection = () => {
      const id = selected();
      version();
      const ids = selectableIDs(pageLines({ live: source.live, status: source.status, baseURL, now: clock(), cols: 80, showIdle: showIdle() }));
      return ids.includes(id) ? id : ids[0];
    };
    const move = (delta) => {
      const ids = selectableIDs(lines());
      if (!ids.length) return;
      const index = Math.max(0, ids.indexOf(currentSelection()));
      setSelected(ids[Math.min(ids.length - 1, Math.max(0, index + delta))]);
    };
    const row = () => source.live?.rows.get(currentSelection());
    ctx.keymap.layer(() => ({ commands: [
      { bind: 'escape,q', title: 'Back', group: 'Fleet', run: back },
      { bind: 'down,j', title: 'Next session', group: 'Fleet', run: () => move(1) },
      { bind: 'up,k', title: 'Previous session', group: 'Fleet', run: () => move(-1) },
      { bind: 'return', title: 'Open session', group: 'Fleet', run: () => { const r = row(); if (r) openSession(r.id); } },
      { bind: 'o', title: 'Open in web', group: 'Fleet', run: () => {
        const r = row();
        if (!r?.web) return;
        void (deps.openURL ?? openURL)(r.web).then((ok) => { if (!ok) ctx.ui.toast.show({ variant: 'info', message: 'No URL opener here; use the Fleet web view' }); }, () => {});
      } },
      { bind: 'i', title: 'Toggle idle sessions', group: 'Fleet', run: () => setShowIdle((v) => !v) },
    ] }));
    const header = () => {
      version();
      const status = statusLabel(source.status, source.live);
      const cols = Math.max(20, dimensions().width - 4);
      const left = 'Fleet';
      return h('text', { wrapMode: 'none', selectable: false },
        span({ text: left, tone: 'base', bold: true }),
        span({ text: ' '.repeat(Math.max(1, cols - left.length - width(status.text))), tone: 'muted' }),
        span({ text: status.text, tone: status.tone }));
    };
    const body = () => {
      const all = lines();
      const height = Math.max(1, dimensions().height - 5);
      const index = all.findIndex((l) => l.selected);
      top = scrollTop(top, index, all.length, height);
      return all.slice(top, top + height).map((line) => h('box', {
        height: 1, flexShrink: 0, ...(line.selected ? { backgroundColor: theme().background.raised.high } : {}),
      }, h('text', { wrapMode: 'none', selectable: false }, ...line.parts.map((p) => span(p, false)))));
    };
    return h('box', {
      width: () => dimensions().width, height: () => dimensions().height, flexDirection: 'column',
      backgroundColor: () => theme().background.base, paddingLeft: 2, paddingRight: 2, paddingTop: 1,
    },
    h('box', { height: 1, flexShrink: 0 }, header),
    h('box', { height: 1, flexShrink: 0 }),
    h('box', { flexGrow: 1, flexDirection: 'column' }, body),
    h('box', { height: 1, flexShrink: 0 }, () => h('text', { wrapMode: 'none', selectable: false },
      span({ text: 'j/k select · enter open · o web · i idle · esc back', tone: 'muted' }))));
  }

  function Commands() {
    ctx.keymap.layer(() => ({ mode: 'global', commands: [
      { id: 'fleet.open', title: 'Fleet', description: 'Every OpenCode session by state', group: 'Fleet', bind: KEYS.open, palette: true, slash: { name: 'fleet' }, run: openPage },
      { id: 'fleet.next', title: 'Next needs-you session', description: 'Jump to the next session waiting on you (Fleet)', group: 'Fleet', bind: KEYS.next, palette: true, run: nextSession },
    ] }));
    return null;
  }

  const cleanups = [
    ctx.ui.router.register({ name: ROUTE, render: () => runtime.createComponent(FleetPage, {}) }),
    ctx.ui.slot({ append: 'app', render: () => runtime.createComponent(Commands, {}) }),
    ctx.ui.slot({ append: 'home.footer.status', render: () => badge }),
    // The home route has a prompt too; its footer badge would repeat the home footer's.
    ctx.ui.slot({ append: 'prompt.footer.status', render: (input) => () => (input.sessionID ? badge() : null) }),
  ];
  const interval = timers.setInterval(() => setTick((v) => v + 1), 30_000);
  source.start();
  return () => {
    timers.clearInterval(interval);
    notifier.stop();
    source.stop();
    for (const cleanup of cleanups.reverse()) { try { cleanup?.(); } catch { /* host already removed it */ } }
  };
}
