import test from 'node:test';
import assert from 'node:assert/strict';
import { setupUsage } from './view.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function uiHarness() {
  const calls = [], alerts = [], toasts = [];
  let command, slots = 0, route = { type: 'session', sessionID: 'ses' };
  const ctx = {
    keymap: { layer(fn) { command = fn().commands[0]; } },
    data: { session: { get() { return { location: { directory: '/repo', workspaceID: 'workspace' } }; } } },
    client: { rpc() { return { get(input, options) { const gate = deferred(); calls.push({ input, options, ...gate }); return gate.promise; } }; } },
    ui: {
      router: { current: () => route }, dialog: { async alert(value) { alerts.push(value); } }, toast: { show(value) { toasts.push(value); } },
      // The keymap layer must be created while the `app` slot renders, never in setup.
      slot(claim) { assert.equal(claim.append, 'app'); assert.equal(command, undefined); slots++; claim.render(); return () => { slots--; }; },
    },
  };
  const cleanup = setupUsage(ctx, (component, props) => component(props));
  assert.equal(command.slash.name, 'subscription-usage'); assert.deepEqual(command.slash.aliases, ['quota']);
  return { run: () => command.run(), cleanup, calls, alerts, toasts, route(value) { route = value; }, get slots() { return slots; } };
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
  assert.equal(ui.calls[1].options.signal.aborted, true); assert.equal(ui.slots, 0);
  ui.calls[1].resolve({ status: 'available', text: 'late' }); await second;
  assert.equal(ui.alerts.length, 0); assert.equal(ui.toasts.length, 0);
});
