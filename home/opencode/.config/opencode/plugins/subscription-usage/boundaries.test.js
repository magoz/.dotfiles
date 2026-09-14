import test from 'node:test';
import assert from 'node:assert/strict';
import server from './server.js';
import tui from './tui.js';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('native server RPC passes context.signal through get/fetch; unload disposes and cancels', async () => {
  const original = globalThis.fetch;
  let handlers, disposed = false, fetchSignal, canceled = 0;
  globalThis.fetch = async (_url, options) => {
    fetchSignal = options.signal;
    return new Response(new ReadableStream({ cancel() { canceled++; } }));
  };
  const ctx = {
    location: { directory: '/repo' },
    session: { async get({ sessionID }) { return { id: sessionID, location: { directory: '/repo' }, model: { providerID: 'openai', id: 'model' } }; } },
    catalog: { provider: { async get() { return { data: { id: 'openai', integrationID: 'openai' } }; } }, model: { async list() { return { data: [{ providerID: 'openai', id: 'model' }] }; } } },
    integration: { connection: { async active() { return { type: 'credential', id: 'synthetic' }; }, async resolve() { return { type: 'oauth', access: 'synthetic-only' }; } } },
    rpc: { async register(_definition, value) { handlers = value; return { async dispose() { disposed = true; } }; } },
  };
  let cleanup;
  try {
    cleanup = await server.setup(ctx);
    const request = new AbortController();
    const pending = handlers.get({ sessionID: 'ses' }, { signal: request.signal });
    await tick(); request.abort();
    assert.equal((await pending).status, 'unavailable'); assert.equal(fetchSignal.aborted, true); assert.equal(canceled, 1);
    const next = handlers.get({ sessionID: 'ses' }, { signal: new AbortController().signal });
    await tick(); await cleanup();
    assert.equal((await next).status, 'unavailable'); assert.equal(fetchSignal.aborted, true); assert.equal(canceled, 2); assert.equal(disposed, true);
  } finally { if (cleanup) await cleanup(); globalThis.fetch = original; }
});

function uiHarness() {
  const calls = [], alerts = [], toasts = [];
  let command, route = { type: 'session', sessionID: 'ses' };
  const ctx = {
    keymap: { layer(fn) { command = fn().commands[0].run; } },
    data: { session: { get() { return { location: { directory: '/repo', workspaceID: 'workspace' } }; } } },
    client: { rpc() { return { get(input, options) { const gate = deferred(); calls.push({ input, options, ...gate }); return gate.promise; } }; } },
    ui: { router: { current: () => route }, dialog: { async alert(value) { alerts.push(value); } }, toast: { show(value) { toasts.push(value); } } },
  };
  const cleanup = tui.setup(ctx);
  return { run: () => command(), cleanup, calls, alerts, toasts, route(value) { route = value; } };
}
test('TUI overlap cancels prior RPC; only newest sanitized snapshot shown', async () => {
  const ui = uiHarness();
  try {
    const first = ui.run(), second = ui.run();
    assert.equal(ui.calls[0].options.signal.aborted, true);
    assert.deepEqual(ui.calls[1].options.location, { directory: '/repo', workspace: 'workspace' });
    ui.calls[1].resolve({ status: 'stale', text: '5h: 20% left\n(stale)' }); await second;
    ui.calls[0].resolve({ status: 'available', text: 'obsolete' }); await first;
    assert.equal(ui.alerts.length, 1); assert.match(ui.alerts[0].message, /stale/); assert.equal(ui.toasts.length, 0);
  } finally { ui.cleanup(); }
});
test('TUI rejects malformed/error payloads with fixed warning, never provider error text', async () => {
  const ui = uiHarness();
  try {
    for (const result of [null, { status: 'available', text: 'x'.repeat(2049) }, { status: 'bad', text: 'secret' }]) {
      const pending = ui.run(); ui.calls.at(-1).resolve(result); await pending;
    }
    const pending = ui.run(); ui.calls.at(-1).reject(new Error('provider secret')); await pending;
    assert.equal(ui.alerts.length, 0); assert.equal(ui.toasts.length, 4);
    assert.ok(ui.toasts.every((item) => item.message === 'Subscription quota unavailable.'));
  } finally { ui.cleanup(); }
});
test('TUI route change and unload suppress late success/errors; unload cancels native RPC', async () => {
  const ui = uiHarness();
  const first = ui.run(); ui.route({ type: 'home' }); ui.calls[0].reject(new Error('late')); await first;
  ui.route({ type: 'session', sessionID: 'ses' });
  const second = ui.run(); ui.cleanup();
  assert.equal(ui.calls[1].options.signal.aborted, true);
  ui.calls[1].resolve({ status: 'available', text: 'late' }); await second;
  assert.equal(ui.alerts.length, 0); assert.equal(ui.toasts.length, 0);
});
