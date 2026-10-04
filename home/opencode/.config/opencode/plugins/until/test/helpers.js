// Plain-JS helpers for the TUI view tests (the view runs under the host's Solid runtime).
export const flush = async (rounds = 5) => { for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve)); };

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
