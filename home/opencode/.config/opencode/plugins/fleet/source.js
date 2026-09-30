// Fleet network source: GET /api/fleet snapshot plus the /api/fleet/events SSE stream, with
// timeouts, a heartbeat watchdog and capped exponential reconnect. Fleet has no auth: requests
// carry no credentials. Every failure is reported as status, never thrown into the host.
import { applyChange, parseChange, parseSnapshot, reconnectDelay } from './fleet.js';

/** Incremental `text/event-stream` parser; `push` takes decoded text chunks. */
export function createSseParser(onEvent) {
  let buffer = '', event = '', data = [];
  const line = (text) => {
    if (text === '') {
      if (data.length) onEvent({ event: event || 'message', data: data.join('\n') });
      event = ''; data = [];
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon < 0 ? text : text.slice(0, colon);
    const value = colon < 0 ? '' : text.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };
  return {
    push(chunk) {
      buffer += chunk;
      // Bound memory if a peer never ends a line.
      if (buffer.length > 4 * 1024 * 1024) { buffer = ''; event = ''; data = []; return; }
      let index;
      while ((index = buffer.search(/\r\n|\r|\n/)) >= 0) {
        const text = buffer.slice(0, index);
        buffer = buffer.slice(index + (buffer.startsWith('\r\n', index) ? 2 : 1));
        line(text);
      }
    },
  };
}

/**
 * Keeps a live Fleet model. Status: `connecting` (never connected yet), `live` (stream up and
 * snapshot loaded), `reconnecting` (stream lost, retrying), `unreachable` (3+ failures in a row).
 * `onUpdate({ live, status, reason })` fires on every model or status change; `reason` is
 * `snapshot`, `change` or `status`.
 */
export function createFleetSource({
  baseURL, onUpdate, fetch = globalThis.fetch, timers = globalThis,
  requestTimeoutMs = 10_000, idleTimeoutMs = 45_000, unreachableAfter = 3,
}) {
  const lifetime = new AbortController();
  let live, status = 'connecting', failures = 0, retry, snapshotRequest, started = false;

  const emit = (reason) => { if (!lifetime.signal.aborted) { try { onUpdate({ live, status, reason }); } catch { /* host errors stay out of the stream */ } } };
  const setStatus = (next) => { if (next !== status) { status = next; emit('status'); } };
  const withTimeout = (signal, ms) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = timers.setTimeout(abort, ms);
    signal.addEventListener('abort', abort, { once: true });
    const done = () => { timers.clearTimeout(timer); signal.removeEventListener('abort', abort); };
    return { signal: controller.signal, done, abort };
  };

  async function loadSnapshot() {
    snapshotRequest?.abort();
    const request = withTimeout(lifetime.signal, requestTimeoutMs);
    snapshotRequest = request;
    try {
      const response = await fetch(`${baseURL}/api/fleet`, { signal: request.signal, headers: { accept: 'application/json' }, redirect: 'error', credentials: 'omit' });
      if (!response.ok) return false;
      const next = parseSnapshot(await response.json());
      if (!next || snapshotRequest !== request || lifetime.signal.aborted) return false;
      live = next;
      emit('snapshot');
      return true;
    } catch { return false; }
    finally { request.done(); if (snapshotRequest === request) snapshotRequest = undefined; }
  }

  function handle(message) {
    if (message.event !== 'fleet.changed') return;
    let change;
    try { change = parseChange(JSON.parse(message.data)); } catch { return; }
    if (!change) return;
    if (change.initial) {
      failures = 0;
      // Reload after the first event of every connection so no change falls in between.
      void loadSnapshot().then((ok) => { if (ok) setStatus('live'); });
      return;
    }
    if (!live) return;
    const applied = applyChange(live, change);
    live = applied.live;
    emit('change');
    if (applied.stale) void loadSnapshot();
  }

  async function connect() {
    retry = undefined;
    if (lifetime.signal.aborted) return;
    const request = withTimeout(lifetime.signal, requestTimeoutMs);
    let watchdog;
    const touch = () => { timers.clearTimeout(watchdog); watchdog = timers.setTimeout(request.abort, idleTimeoutMs); };
    try {
      const response = await fetch(`${baseURL}/api/fleet/events`, { signal: request.signal, headers: { accept: 'text/event-stream' }, redirect: 'error', credentials: 'omit' });
      if (!response.ok || !response.body) throw new Error('Fleet stream unavailable');
      request.done();
      // `done` detached the lifetime link; re-link it for the streaming phase.
      lifetime.signal.addEventListener('abort', request.abort, { once: true });
      touch();
      const parser = createSseParser(handle);
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        touch();
        parser.push(decoder.decode(value, { stream: true }));
      }
    } catch { /* reconnect below */ }
    finally {
      timers.clearTimeout(watchdog);
      request.done();
      lifetime.signal.removeEventListener('abort', request.abort);
    }
    if (lifetime.signal.aborted) return;
    const delay = reconnectDelay(failures);
    failures += 1;
    setStatus(failures >= unreachableAfter ? 'unreachable' : status === 'connecting' ? 'connecting' : 'reconnecting');
    retry = timers.setTimeout(() => void connect(), delay);
  }

  return {
    start() {
      if (started) return;
      started = true;
      void loadSnapshot();
      void connect();
    },
    stop() {
      lifetime.abort();
      if (retry) timers.clearTimeout(retry);
      retry = undefined;
    },
    get live() { return live; },
    get status() { return status; },
  };
}
