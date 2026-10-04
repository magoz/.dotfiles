// `until` terminal view: a dock above the composer while watches run, slash commands, a watch
// picker, and toasts for `wake=notify` results. The OpenTUI Solid runtime is injected (see
// tui.js), so this module builds elements without JSX and runs under node --test.
import { rpcLocation } from '../dotfiles-tools/tui.js';
import { formatDuration } from './format.ts';
import { definition } from './rpc.ts';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const DOCK_ROWS = 3;
const POLL_MS = 5000;
/** OpenCode's own queued-prompt dock border (tui/src/ui/border.ts SplitBorder). */
const SPLIT_BORDER = { topLeft: '', bottomLeft: '', vertical: '┃', topRight: '', bottomRight: '', horizontal: ' ', bottomT: '', topT: '', cross: '', leftT: '', rightT: '' };

/** Declared RPC errors (`until.error`) arrive as `{ type, message }`; anything else is generic. */
const failure = (error, fallback) => (error?.type === 'until.error' && typeof error.message === 'string' ? error.message : fallback);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function statusText(watch, now) {
  if (watch.status !== 'running') return watch.status === 'timedOut' ? 'timed out' : watch.status;
  if (watch.phase === 'checking') return 'checking';
  if (watch.phase === 'queued') return 'due · waiting for idle';
  if (watch.phase === 'delivering') return 'follow-up running';
  return `next ${formatDuration(watch.nextDueAt - now)}`;
}

export function icon(watch, now) {
  if (watch.status === 'succeeded' || watch.status === 'completed') return { text: '✓', tone: 'success' };
  if (watch.status === 'failed' || watch.status === 'timedOut' || watch.status === 'expired') return { text: '✗', tone: 'error' };
  if (watch.status === 'cancelled') return { text: '■', tone: 'muted' };
  if (watch.phase === 'checking') return { text: SPINNER[Math.floor(now / 120) % SPINNER.length], tone: 'info' };
  return { text: watch.kind === 'recurring' ? '↻' : '◷', tone: 'info' };
}

export function activity(watch) {
  return watch.kind === 'recurring'
    ? `${plural(watch.deliveries, 'wake')}${watch.missedTicks ? ` · ${watch.missedTicks} missed` : ''}`
    : plural(watch.attempts, 'check');
}

export function detail(watch, now) {
  const elapsed = formatDuration((watch.finishedAt ?? now) - watch.startedAt);
  const wake = watch.kind === 'until' && watch.wake === 'notify' ? ' · notify only' : '';
  const flag = watch.wakeFailed ? ' · wake failed' : '';
  return `${statusText(watch, now)} · ${elapsed} · ${activity(watch)}${wake}${flag}`;
}

/** Dock content: one line per running watch (at most DOCK_ROWS), then `+N more`. */
export function dockLines(watches, now) {
  const running = watches.filter((w) => w.status === 'running');
  if (!running.length) return [];
  const lines = running.slice(0, DOCK_ROWS).map((w) => [
    icon(w, now), { text: ' ', tone: 'muted' }, { text: w.label, tone: 'base' },
    { text: ` · ${statusText(w, now)} · ${formatDuration(now - w.startedAt)} · ${activity(w)}`, tone: 'muted' },
  ]);
  const more = running.length - DOCK_ROWS;
  lines[lines.length - 1].push({ text: more > 0 ? `  +${more} more · /until-list` : '', tone: 'muted' });
  return lines;
}

export function pickerOptions(watches, now) {
  return watches.map((w) => ({
    title: `${icon(w, now).text} ${w.label}`,
    value: w.id,
    description: detail(w, now),
    footer: w.id,
    category: w.status === 'running' ? 'Active' : 'Finished',
  }));
}

/** Hyperscript over the injected Solid universal runtime; function props/children are reactive. */
function createH(r) {
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

export function setupUntil(ctx, runtime, deps = {}) {
  const clock = deps.now ?? Date.now;
  const timers = deps.timers ?? globalThis;
  const lifetime = new AbortController();
  const alive = () => !lifetime.signal.aborted;
  const h = createH(runtime);
  const rpc = ctx.client.rpc(definition);
  const [version, setVersion] = runtime.createSignal(0);
  const [tick, setTick] = runtime.createSignal(0);
  const cache = new Map(); // sessionID -> { watches, fetchedAt, dirty }
  const inflight = new Set();

  const toast = (variant, message, extra = {}) => { if (alive()) ctx.ui.toast.show({ variant, message, ...extra }); };
  const currentSession = () => { const route = ctx.ui.router.current(); return route.type === 'session' ? route.sessionID : undefined; };
  const options = (sessionID, timeout = 5000) => {
    const location = ctx.data.session.get(sessionID)?.location;
    return location ? { location: rpcLocation(location), signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(timeout)]) } : undefined;
  };
  // Watches belong to the family root (a subagent's watches wake its main session), so the cache
  // is keyed by root and a subagent's view shows the family's watches.
  const rootOf = (sessionID) => (sessionID && ctx.data.session.root?.(sessionID)) || sessionID;
  const watchesOf = (sessionID) => { version(); return cache.get(rootOf(sessionID))?.watches ?? []; };

  const refresh = async (sessionID) => {
    const root = rootOf(sessionID);
    if (!root || inflight.has(root)) return;
    const call = options(sessionID);
    if (!call) return;
    inflight.add(root);
    try {
      const result = await rpc.list({ sessionID }, call);
      if (!alive() || !Array.isArray(result?.watches)) return;
      cache.set(root, { watches: result.watches, fetchedAt: clock(), dirty: false });
      setVersion((v) => v + 1);
    } catch { /* the plugin location may still be booting; the next poll retries */ }
    finally { inflight.delete(root); }
  };

  const sessionFor = async (verb) => {
    const sessionID = currentSession();
    if (!sessionID) toast('info', `Open a session to ${verb} until watches`);
    return sessionID;
  };

  const startWatch = async (raw = '') => {
    const sessionID = await sessionFor('start');
    if (!sessionID) return;
    const condition = raw.trim() || (await ctx.ui.dialog.prompt({ title: 'until', description: 'Side-effect-free shell condition; exit 0 means true. The agent wakes when it is.', placeholder: 'test -f build/done' }))?.trim();
    if (!condition) return;
    const call = options(sessionID, 10000);
    if (!call) return;
    try {
      const result = await rpc.start({ sessionID, condition }, call);
      toast('info', `Watching ${result.label} as ${result.id}`);
      void refresh(sessionID);
    } catch (error) { toast('error', failure(error, 'until is unavailable for this session')); }
  };

  const manage = async (sessionID, verb, id) => {
    const call = options(sessionID, 10000);
    if (!call) return;
    try {
      const result = await rpc[verb]({ sessionID, id }, call);
      if (verb === 'status') return ctx.ui.dialog.alert({ title: `until · ${id}`, message: result.text });
      toast('info', `${verb === 'cancel' ? 'Cancelled' : 'Completed'} ${id}`);
      void refresh(sessionID);
    } catch (error) { toast('warning', failure(error, 'until is unavailable for this session')); }
  };

  /** `/until-cancel <id>` and friends; without an ID, pick from the running watches. */
  const pickThen = (verb) => async (raw = '') => {
    const sessionID = await sessionFor(verb);
    if (!sessionID) return;
    let id = raw.trim();
    if (!id) {
      await refresh(sessionID);
      const candidates = watchesOf(sessionID).filter((w) => w.status === 'running' && (verb !== 'complete' || w.kind === 'recurring'));
      if (!candidates.length) return toast('info', verb === 'complete' ? 'No running recurring watches' : 'No running watches');
      id = await ctx.ui.dialog.select({ title: `until · ${verb}`, options: pickerOptions(candidates, clock()) });
      if (!id) return;
    }
    await manage(sessionID, verb, id);
  };

  const openList = async () => {
    const sessionID = await sessionFor('list');
    if (!sessionID) return;
    await refresh(sessionID);
    const watches = watchesOf(sessionID);
    if (!watches.length) return toast('info', 'No until watches in this session');
    const id = await ctx.ui.dialog.select({ title: 'until · this session', placeholder: 'Search watches', options: pickerOptions(watches, clock()) });
    const watch = watches.find((w) => w.id === id);
    if (!watch) return;
    const actions = [
      { title: 'Status', value: 'status', description: 'Show the full receipt' },
      ...(watch.status === 'running' && watch.kind === 'recurring' ? [{ title: 'Complete', value: 'complete', description: 'The recurring goal is achieved' }] : []),
      ...(watch.status === 'running' ? [{ title: 'Cancel', value: 'cancel', description: 'Stop without success; nobody is woken' }] : []),
    ];
    const verb = await ctx.ui.dialog.select({ title: `until · ${watch.label}`, options: actions });
    if (verb) await manage(sessionID, verb, watch.id);
  };

  const stats = async () => {
    const sessionID = currentSession();
    const call = sessionID ? options(sessionID, 10000) : undefined;
    if (!call) return toast('info', 'Open a session to read until stats');
    try {
      const result = await rpc.stats({}, call);
      await ctx.ui.dialog.alert({ title: 'until stats', message: result.text });
    } catch (error) { toast('warning', failure(error, 'until stats are unavailable')); }
  };

  const theme = () => ctx.theme;
  const TONES = {
    base: (t) => t.text.base, muted: (t) => t.text.muted, info: (t) => t.text.feedback.info.base,
    success: (t) => t.text.feedback.success.base, error: (t) => t.text.feedback.error.base,
  };
  const span = (part) => h('span', { style: { fg: (TONES[part.tone] ?? TONES.base)(theme()) } }, part.text);

  function Dock(input) {
    return h('box', { flexShrink: 0 }, () => {
      tick();
      const lines = dockLines(watchesOf(input.sessionID), clock());
      if (!lines.length) return null;
      return h('box', { border: ['left'], borderColor: theme().border.base, customBorderChars: SPLIT_BORDER, onMouseUp: () => void openList() },
        h('box', { width: '100%', paddingTop: 1, paddingBottom: 1, paddingLeft: 2, paddingRight: 1, flexDirection: 'column', backgroundColor: theme().background.raised.base },
          ...lines.map((parts) => h('text', { wrapMode: 'none', truncate: true, selectable: false }, ...parts.map(span)))));
    });
  }

  // CLI plugins create keymap layers inside a rendered slot, never directly in setup.
  function Commands() {
    ctx.keymap.layer(() => ({ commands: [
      { id: 'until.start', title: 'until: Watch a condition', description: 'Wake the agent when a shell condition exits 0', group: 'until', palette: true, slash: { name: 'until', arguments: true }, run: startWatch },
      { id: 'until.list', title: 'until: Watches', description: 'Watches owned by this session', group: 'until', palette: true, slash: { name: 'until-list' }, run: openList },
      { id: 'until.cancel', title: 'until: Cancel a watch', group: 'until', palette: true, slash: { name: 'until-cancel', arguments: true }, run: pickThen('cancel') },
      { id: 'until.complete', title: 'until: Complete a recurring watch', group: 'until', palette: true, slash: { name: 'until-complete', arguments: true }, run: pickThen('complete') },
      { id: 'until.stats', title: 'until: Usage stats', group: 'until', palette: true, slash: { name: 'until-stats' }, run: stats },
    ] }));
    return null;
  }

  const unsubscribe = [
    rpc.events.on('changed', (event) => {
      const sessionID = event?.data?.sessionID;
      const current = currentSession();
      if (typeof sessionID !== 'string') return;
      if (sessionID === rootOf(current)) void refresh(current);
      else if (cache.has(sessionID)) void refresh(sessionID);
    }, { signal: lifetime.signal }),
    rpc.events.on('notify', (event) => {
      const data = event?.data;
      if (!data || typeof data.message !== 'string') return;
      toast(data.variant ?? 'info', data.message, { title: data.title, sessionID: data.sessionID, duration: 10000 });
      void Promise.resolve().then(() => ctx.attention.notify({ title: data.title, message: data.message, notification: { when: 'blurred' }, sound: false })).catch(() => {});
    }, { signal: lifetime.signal }),
  ];
  const interval = timers.setInterval(() => {
    setTick((v) => v + 1);
    const sessionID = currentSession();
    const entry = sessionID ? cache.get(rootOf(sessionID)) : undefined;
    if (sessionID && (!entry || entry.dirty || clock() - entry.fetchedAt >= POLL_MS)) void refresh(sessionID);
  }, 1000);
  const cleanups = [
    ctx.ui.slot({ append: 'app', render: () => runtime.createComponent(Commands, {}) }),
    ctx.ui.slot({ prepend: 'session.composer.top', render: (input) => runtime.createComponent(Dock, input) }),
  ];
  void refresh(currentSession());
  return () => {
    lifetime.abort();
    timers.clearInterval(interval);
    for (const off of unsubscribe) { try { off?.(); } catch { /* already gone */ } }
    for (const cleanup of cleanups.reverse()) { try { cleanup?.(); } catch { /* host already removed it */ } }
  };
}
