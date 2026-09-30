// Test fixtures shaped like Fleet's wire schema (fleet repo `lib/data/fleet/types.ts`).
export const NOW = 1_790_000_000_000;

const links = { web: 'https://box.example/s', terminal: 'ocb://x', command: 'ocb x' };

export function wireRow(id, state, extra = {}) {
  return {
    id, projectID: 'p1', directory: '/repo', title: `T ${id}`, cost: 0, updated: NOW - 60_000, ownState: state, state,
    unseen: state === 'done', running: state === 'working', permissions: [], forms: [], links,
    pending: { permissions: 0, forms: 0 }, children: [], ...extra,
  };
}

export function wireSnapshot(rows, connection = 'connected') {
  return {
    generatedAt: NOW, counts: {}, connection: { status: connection, since: NOW, failures: 0 },
    projects: [
      { id: 'p1', name: 'box', directory: '/repo', worktrees: [
        { directory: '/repo', kind: 'root', rows: rows.filter((r) => r.directory === '/repo') },
        { directory: '/wt/feat-x', kind: 'worktree', rows: rows.filter((r) => r.directory === '/wt/feat-x') },
      ] },
      { id: 'global', name: 'global', directory: '/', worktrees: [
        { directory: '/tmp/scratch', kind: 'directory', rows: rows.filter((r) => r.directory === '/tmp/scratch') },
      ] },
    ],
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
export const flush = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };

/** Manual timers: `run(ms)` fires due callbacks in order. */
export function fakeTimers() {
  let now = 0, id = 0;
  const pending = new Map(), intervals = new Set();
  return {
    setTimeout: (fn, ms) => { pending.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout: (handle) => { pending.delete(handle); },
    setInterval: () => { intervals.add(++id); return id; }, clearInterval: (handle) => { intervals.delete(handle); },
    intervals: () => intervals.size,
    delays: () => [...pending.values()].map((t) => t.at - now).sort((a, b) => a - b),
    async run(ms) {
      now += ms;
      for (const [key, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) continue;
        pending.delete(key);
        t.fn();
        await flush();
      }
    },
  };
}

/** Streaming SSE body the test pushes into; aborting the request errors the reader. */
function sseStream(signal) {
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; } });
  signal.addEventListener('abort', () => { try { controller.error(new Error('aborted')); } catch { /* closed */ } });
  const encoder = new TextEncoder();
  return {
    response: { ok: true, body },
    send: (text) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

export function fakeFetch() {
  const calls = [], streams = [];
  let snapshot = wireSnapshot([wireRow('w', 'working')]);
  let down = false;
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (down) throw new TypeError('fetch failed');
    if (url.endsWith('/api/fleet')) return { ok: true, json: async () => structuredClone(snapshot) };
    const stream = sseStream(options.signal);
    streams.push(stream);
    return stream.response;
  };
  return { fetch, calls, streams, setSnapshot: (s) => { snapshot = s; }, setDown: (v) => { down = v; } };
}

export const change = (payload) => `event: fleet.changed\ndata: ${JSON.stringify({ connection: { status: 'connected' }, counts: {}, rows: [], removed: [], ...payload })}\n\n`;
