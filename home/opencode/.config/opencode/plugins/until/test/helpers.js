import assert from 'node:assert/strict';

export const flush = async (rounds = 5) => { for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve)); };

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Manual clock and timers; `advance` runs due timers in order and lets their promises settle. */
export function fakeClock(start = 1_000_000) {
  let now = start, seq = 0;
  const timers = new Map();
  const add = (fn, ms, every) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn, every }); return id; };
  return {
    now: () => now,
    timers: {
      setTimeout: (fn, ms) => add(fn, ms),
      clearTimeout: (id) => { timers.delete(id); },
      setInterval: (fn, ms) => add(fn, ms, ms),
      clearInterval: (id) => { timers.delete(id); },
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush();
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = Math.max(now, timer.at);
        if (timer.every) timer.at = now + timer.every; else timers.delete(id);
        timer.fn();
      }
      now = end;
      await flush();
    },
    get size() { return timers.size; },
  };
}

export function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key) { return data.get(key); },
    async set(key, value) { data.set(key, JSON.parse(JSON.stringify(value))); },
    async remove(key) { data.delete(key); },
    async scan({ prefix, after, limit = 100 }) {
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix) && (after === undefined || k > after)).sort();
      const page = keys.slice(0, limit);
      return { entries: page.map((key) => ({ key, value: data.get(key) })), ...(keys.length > limit ? { next: page.at(-1) } : {}) };
    },
  };
}

/** Scripted check results: each call shifts the next value; a function result is called with the signal. */
export function scriptedRun(results) {
  const calls = [];
  const run = async (gate, signal) => {
    calls.push({ gate, signal });
    const next = results.length > 1 ? results.shift() : results[0];
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(signal) : next;
  };
  return { run, calls };
}

export const location = { directory: '/repo' };

export function eventStream() {
  const queue = [];
  let wake;
  return {
    emit(event) { queue.push(event); wake?.(); },
    async *subscribe({ signal } = {}) {
      const abort = () => wake?.();
      signal?.addEventListener('abort', abort);
      try {
        while (!signal?.aborted) {
          if (queue.length) yield queue.shift();
          else await new Promise((resolve) => { wake = resolve; });
        }
      } finally { signal?.removeEventListener('abort', abort); }
    },
  };
}

export const ok = (value) => { assert.ok(value); return value; };
