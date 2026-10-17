// Vltra's request/response routes (besides the live stream in source.js): the launcher list,
// branch suggestions, finished-run summaries and the JSON mutation routes (DESIGN.md "Vltra API").
// Mutations send `Origin` = Vltra's own origin and `content-type: application/json`: Vltra's
// same-origin guard rejects anything else (403 / 415). Vltra has no auth; no credentials are sent.
// Every call resolves `{ ok: true, value }` or `{ ok: false, error, status?, missing? }`; never throws.
import { clean, parseLauncher } from './vltra.js';

const object = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const string = (v) => typeof v === 'string' && v !== '';
const ok = (value) => ({ ok: true, value });

const parsers = {
  handled: (v) => object(v) && string(v.sessionID) && ['handled', 'already-handled'].includes(v.outcome) ? { sessionID: v.sessionID, outcome: v.outcome } : undefined,
  reopen: (v) => object(v) && string(v.sessionID) && ['reopened', 'not-handled'].includes(v.outcome) ? { sessionID: v.sessionID, outcome: v.outcome } : undefined,
  launch: (v) => object(v) && string(v.launchID) ? { launchID: v.launchID } : undefined,
  opened: (v) => object(v) && string(v.sessionID) && typeof v.created === 'boolean' ? { sessionID: v.sessionID, created: v.created } : undefined,
  branch: (v) => object(v) && string(v.branch) && ['model', 'fallback'].includes(v.source) ? { branch: clean(v.branch, 120), source: v.source } : undefined,
  summary: (v) => object(v) && string(v.sessionID) ? { answer: typeof v.answer === 'string' ? v.answer : undefined } : undefined,
};

/**
 * `baseURL` without a trailing slash; `signal` aborts everything in flight (plugin dispose).
 * A failure is `missing` when the route answered 404/405 without Vltra's `{ error }` body, i.e.
 * the deployed Vltra predates the route.
 */
export function createVltraApi({ baseURL, fetch = globalThis.fetch, timers = globalThis, signal, timeoutMs = 10_000 }) {
  const origin = new URL(baseURL).origin;

  async function call(method, path, parse, { body, timeout = timeoutMs } = {}) {
    if (signal?.aborted) return { ok: false, error: 'Vltra plugin stopped' };
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    const timer = timers.setTimeout(() => { timedOut = true; abort(); }, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const headers = method === 'POST'
        ? { accept: 'application/json', 'content-type': 'application/json', origin }
        : { accept: 'application/json' };
      const response = await fetch(`${baseURL}${path}`, {
        method, headers, signal: controller.signal, redirect: 'error', credentials: 'omit',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let data;
      try { data = await response.json(); } catch { data = undefined; }
      if (!response.ok) {
        const error = object(data) ? clean(data.error, 300) : undefined;
        return { ok: false, status: response.status, error: error || `Vltra answered ${response.status}`, missing: !error && [404, 405].includes(response.status) };
      }
      const value = parse(data);
      return value === undefined ? { ok: false, status: response.status, error: 'Unexpected answer from Vltra' } : ok(value);
    } catch {
      return { ok: false, error: signal?.aborted ? 'Vltra plugin stopped' : timedOut ? 'Vltra did not answer in time' : 'Vltra is not reachable' };
    } finally {
      timers.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  const id = (value) => encodeURIComponent(value);
  return {
    origin,
    /** `GET /api/vltra/launcher` → launcher entries. */
    launcher: () => call('GET', '/api/vltra/launcher', parseLauncher, { timeout: 20_000 }),
    /** `POST /api/vltra/launcher/branch` `{ task }` → `{ branch, source }` (a model call: slower). */
    suggestBranch: (task) => call('POST', '/api/vltra/launcher/branch', parsers.branch, { body: { task }, timeout: 30_000 }),
    /** `GET /api/vltra/sessions/:id/summary?idle=` → `{ answer? }` (cached by Vltra per run). */
    summary: (sessionID, idle) => call('GET', `/api/vltra/sessions/${id(sessionID)}/summary?idle=${encodeURIComponent(String(idle))}`, parsers.summary),
    handled: (sessionID) => call('POST', `/api/vltra/sessions/${id(sessionID)}/handled`, parsers.handled, { body: {} }),
    reopen: (sessionID) => call('POST', `/api/vltra/sessions/${id(sessionID)}/reopen`, parsers.reopen, { body: {} }),
    /** `{ repoDir, branch, task }` → `{ launchID }` at once; progress arrives in `launches`. */
    launch: (input) => call('POST', '/api/vltra/launches', parsers.launch, { body: { repoDir: input.repoDir, branch: input.branch, task: input.task } }),
    dismiss: (launchID) => call('POST', `/api/vltra/launches/${id(launchID)}/dismiss`, parsers.launch, { body: {} }),
    /** `{ directory }` → the checkout's latest root session, or a new empty one (`created`). */
    openCheckout: (directory) => call('POST', '/api/vltra/checkouts/open', parsers.opened, { body: { directory } }),
  };
}
