import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dockLines, pickerOptions, setupUntil, statusText } from '../view.js';
import { fakeClock, flush } from './helpers.js';

const NOW = 1_000_000;
const watch = (over = {}) => ({
  id: 'abcd1234', kind: 'until', label: 'deploy', status: 'running', wake: 'agent', phase: 'sleeping',
  attempts: 5, deliveries: 0, missedTicks: 0, startedAt: NOW - 134000, nextDueAt: NOW + 12000, ...over,
});
const text = (line) => line.map((p) => p.text).join('');

test('dock mirrors pi-until: status, elapsed, activity; at most three rows', () => {
  assert.equal(text(dockLines([watch()], NOW)[0]), '◷ deploy · next 12s · 2m14s · 5 checks');
  assert.equal(text(dockLines([watch({ kind: 'recurring', deliveries: 3, missedTicks: 1, phase: 'delivering' })], NOW)[0]), '↻ deploy · follow-up running · 2m14s · 3 wakes · 1 missed');
  assert.equal(statusText(watch({ phase: 'queued' }), NOW), 'due · waiting for idle');
  assert.deepEqual(dockLines([watch({ status: 'succeeded' })], NOW), []);
  const five = Array.from({ length: 5 }, (_, i) => watch({ id: `w${i}`, label: `w${i}` }));
  const lines = dockLines(five, NOW);
  assert.equal(lines.length, 3); assert.match(text(lines[2]), /\+2 more · \/until-list$/);
});

test('picker groups active/finished and shows the ID', () => {
  const [active, done] = pickerOptions([watch(), watch({ id: 'ffff0000', status: 'timedOut', finishedAt: NOW, wakeFailed: true })], NOW);
  assert.deepEqual(active, { title: '◷ deploy', value: 'abcd1234', description: 'next 12s · 2m14s · 5 checks', footer: 'abcd1234', category: 'Active' });
  assert.equal(done.title, '✗ deploy'); assert.equal(done.description, 'timed out · 2m14s · 5 checks · wake failed'); assert.equal(done.category, 'Finished');
});

function runtime() {
  return {
    createElement: (tag) => ({ tag, props: {}, children: [] }),
    setProp: (node, key, value) => { node.props[key] = value; },
    insert: (node, child) => { node.children.push(child); },
    effect: (fn) => fn(undefined),
    createComponent: (fn, props) => fn(props),
    createSignal: (value) => [() => value, (next) => { value = typeof next === 'function' ? next(value) : next; }],
  };
}

function fixture() {
  const clock = fakeClock(NOW), calls = [], toasts = [], notified = [], slots = [], handlers = {};
  let commands = [], selections = [];
  const server = { watches: [watch()] };
  const ctx = {
    theme: { text: { base: 'b', muted: 'm', feedback: { info: { base: 'i' }, success: { base: 's' }, error: { base: 'e' } } }, border: { base: 'B' }, background: { raised: { base: 'R' } } },
    client: {
      rpc: () => ({
        list: async (input, options) => { calls.push(['list', input, options.location]); return { watches: server.watches }; },
        start: async (input) => {
          calls.push(['start', input]);
          // The real client throws declared RPC errors as { type, message }.
          if (input.condition === 'bad') throw { type: 'until.error', message: 'cwd is not a directory' };
          return { id: 'new00001', label: 'condition', status: 'running' };
        },
        cancel: async (input) => { calls.push(['cancel', input]); return { id: input.id, status: 'cancelled' }; },
        status: async (input) => ({ id: input.id, text: 'receipt' }),
        stats: async () => ({ text: 'stats' }),
        events: { on: (name, handler) => { handlers[name] = handler; return () => { delete handlers[name]; }; } },
      }),
    },
    data: { session: {
      get: (id) => (['ses', 'ses_sub'].includes(id) ? { id, location: { directory: '/repo' } } : undefined),
      root: (id) => (id === 'ses_sub' ? 'ses' : id),
    } },
    attention: { notify: async (value) => { notified.push(value); return { ok: true }; } },
    keymap: { layer: (fn) => { commands = fn().commands; } },
    ui: {
      router: { current: () => ({ type: 'session', sessionID: 'ses' }) },
      toast: { show: (value) => toasts.push(value) },
      slot: (claim) => { slots.push(claim); return () => {}; },
      dialog: {
        prompt: async () => 'test -f prompted',
        select: async () => selections.shift(),
        alert: async (value) => { toasts.push({ alert: value }); },
      },
    },
  };
  return { ctx, clock, calls, toasts, notified, slots, handlers, server, command: (name) => commands.find((c) => c.slash?.name === name), select: (...values) => { selections = values; } };
}

test('setup claims the composer dock and app commands inside a slot; dock renders running watches', async () => {
  const f = fixture();
  const stop = setupUntil(f.ctx, runtime(), { now: f.clock.now, timers: f.clock.timers });
  await flush();
  assert.deepEqual(f.slots.map((s) => s.append ?? s.prepend), ['app', 'session.composer.top']);
  f.slots[0].render();
  assert.deepEqual(['until', 'until-list', 'until-cancel', 'until-complete', 'until-stats'].map((n) => !!f.command(n)), [true, true, true, true, true]);
  assert.deepEqual(f.calls[0], ['list', { sessionID: 'ses' }, { directory: '/repo' }]);
  const dock = f.slots[1].render({ sessionID: 'ses' });
  const rendered = dock.children[0]();
  assert.deepEqual(rendered.props.border, ['left']);
  const line = rendered.children[0].children[0];
  assert.deepEqual(line.children.map((span) => span.children[0]), ['◷', ' ', 'deploy', ' · next 12s · 2m14s · 5 checks', '']);
  f.server.watches = [];
  f.handlers.changed({ data: { sessionID: 'ses' } }); await flush();
  assert.equal(dock.children[0](), null, 'the dock disappears when nothing runs');
  stop();
});

test('/until starts a watch from its argument or a prompt; errors toast', async () => {
  const f = fixture();
  const stop = setupUntil(f.ctx, runtime(), { now: f.clock.now, timers: f.clock.timers });
  f.slots[0].render();
  await f.command('until').run('test -f done');
  assert.deepEqual(f.calls.find((c) => c[0] === 'start'), ['start', { sessionID: 'ses', condition: 'test -f done' }]);
  assert.equal(f.toasts.at(-1).message, 'Watching condition as new00001');
  await f.command('until').run('');
  assert.deepEqual(f.calls.filter((c) => c[0] === 'start')[1][1].condition, 'test -f prompted');
  await f.command('until').run('bad');
  assert.deepEqual(f.toasts.at(-1), { variant: 'error', message: 'cwd is not a directory' });
  stop();
});

test('/until-list opens the picker then an action; /until-cancel without ID picks a running watch', async () => {
  const f = fixture();
  const stop = setupUntil(f.ctx, runtime(), { now: f.clock.now, timers: f.clock.timers });
  f.slots[0].render();
  f.select('abcd1234', 'status');
  await f.command('until-list').run();
  assert.deepEqual(f.toasts.at(-1), { alert: { title: 'until · abcd1234', message: 'receipt' } });
  f.select('abcd1234');
  await f.command('until-cancel').run('');
  assert.deepEqual(f.calls.find((c) => c[0] === 'cancel'), ['cancel', { sessionID: 'ses', id: 'abcd1234' }]);
  await f.command('until-complete').run('');
  assert.equal(f.toasts.at(-1).message, 'No running recurring watches');
  stop();
});

test('notify results toast in-app and notify the desktop when the terminal is blurred', async () => {
  const f = fixture();
  const stop = setupUntil(f.ctx, runtime(), { now: f.clock.now, timers: f.clock.timers });
  f.handlers.notify({ data: { sessionID: 'ses', title: 'until · tests', message: 'condition met', variant: 'success' } });
  await flush();
  assert.deepEqual(f.toasts.at(-1), { variant: 'success', message: 'condition met', title: 'until · tests', sessionID: 'ses', duration: 10000 });
  assert.deepEqual(f.notified, [{ title: 'until · tests', message: 'condition met', notification: { when: 'blurred' }, sound: false }]);
  stop();
  assert.deepEqual(Object.keys(f.handlers), [], 'unload unsubscribes');
});

test('the TUI entry imports only host-provided modules', async () => {
  const source = await readFile(new URL('../tui.js', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['@opentui/solid', 'solid-js', './view.js']);
});

test('a subagent view shows the main session family watches', async () => {
  const f = fixture();
  const stop = setupUntil(f.ctx, runtime(), { now: f.clock.now, timers: f.clock.timers });
  await flush();
  const dock = f.slots[1].render({ sessionID: 'ses_sub' });
  const line = dock.children[0]().children[0].children[0];
  assert.equal(line.children[2].children[0], 'deploy', 'cached under the root, visible from the child');
  stop();
});
