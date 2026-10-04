import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../domain.js';
import { Watches } from '../engine.js';
import { deferred, fakeClock, flush, location, memoryStorage, scriptedRun } from './helpers.js';

const context = (now) => ({ cwd: '/repo', now, isDirectory: () => true });

function harness({ results = [{ code: 1, killed: false }], synthetic, storage = memoryStorage(), sessionExists, retryDelays = [0, 10, 20] } = {}) {
  const clock = fakeClock();
  const script = scriptedRun(results);
  const wakes = [], events = [], telemetry = [];
  const engine = new Watches({
    location, run: script.run, storage, now: clock.now, timers: clock.timers, retryDelays, sessionExists,
    synthetic: synthetic ?? (async (input) => { wakes.push(input); }),
    waitIdle: () => new Promise(() => {}),
    emit: (name, data) => events.push({ name, data }),
    telemetry: { record: (sessionID, event) => telemetry.push({ sessionID, ...event }) },
  });
  const start = (input, options) => engine.start('ses', parseCommand(input, context(clock.now())).definition, options);
  return { clock, script, wakes, events, telemetry, engine, storage, start };
}

test('start checks immediately, polls on cadence, wakes exactly once with a receipt when true', async (t) => {
  const h = harness({ results: [{ code: 1, killed: false }, { code: 1, killed: false }, { code: 0, killed: false }] });
  t.after(() => h.engine.dispose());
  const watch = h.start({ action: 'start', condition: 'test -f done', label: 'build', intervalSeconds: 10 });
  await h.clock.advance(0);
  assert.equal(h.script.calls.length, 1);
  assert.deepEqual(h.script.calls[0].gate, { command: 'test -f done', cwd: '/repo', checkTimeoutMs: 30000 });
  await h.clock.advance(9999); assert.equal(h.script.calls.length, 1);
  await h.clock.advance(1); assert.equal(h.script.calls.length, 2);
  await h.clock.advance(10000);
  assert.equal(watch.facts.status, 'succeeded'); assert.equal(watch.facts.attempts, 3);
  assert.equal(h.wakes.length, 1);
  const [wake] = h.wakes;
  assert.equal(wake.sessionID, 'ses'); assert.equal(wake.delivery, 'queue'); assert.equal(wake.resume, true);
  assert.match(wake.id, /^msg_/); assert.equal(wake.description, 'until · build · condition met after 3 checks (20s)');
  assert.match(wake.text, /confirm the task still needs work[\s\S]*until watch .*: succeeded/);
  assert.deepEqual(wake.metadata, { source: 'until', watchID: watch.id, kind: 'until', status: 'succeeded' });
  await h.clock.advance(60000); assert.equal(h.script.calls.length, 3); assert.equal(h.wakes.length, 1);
  const stored = h.storage.data.get(`watch/ses/${watch.id}`);
  assert.equal(stored.facts.status, 'succeeded'); assert.equal(stored.notice.state, 'sent'); assert.equal(stored.notice.text, undefined);
  assert.deepEqual(h.telemetry.map((e) => e.event), ['started', 'finished']);
  assert.ok(!JSON.stringify(h.telemetry).includes('test -f done'));
});

test('a check that runs past its timeout counts as false and polling continues', async (t) => {
  const h = harness({ results: [{ code: 1, killed: true }, { code: 0, killed: false }] });
  t.after(() => h.engine.dispose());
  const watch = h.start({ action: 'start', condition: 'slow', intervalSeconds: 5 });
  await h.clock.advance(0);
  assert.equal(watch.facts.status, 'running'); assert.deepEqual(watch.facts.lastResult, { code: 1, killed: true });
  await h.clock.advance(5000);
  assert.equal(watch.facts.status, 'succeeded');
});

test('timeout and spawn failure wake the agent instead of stopping silently', async (t) => {
  const h = harness({ results: [{ code: 1, killed: false }] });
  t.after(() => h.engine.dispose());
  const timed = h.start({ action: 'start', condition: 'never', timeoutSeconds: 65, label: 'deploy' });
  await h.clock.advance(65000);
  assert.equal(timed.facts.status, 'timedOut');
  assert.equal(h.wakes.length, 1); assert.match(h.wakes[0].text, /^The watch timed out/);
  assert.equal(h.wakes[0].description, 'until · deploy · timed out after 3 checks');
  h.engine.run = async () => { throw new Error('could not start condition: ENOENT'); };
  const broken = h.start({ action: 'start', condition: 'x' });
  await h.clock.advance(0);
  assert.equal(broken.facts.status, 'failed'); assert.equal(broken.facts.failure, 'could not start condition: ENOENT');
  assert.match(h.wakes[1].text, /^The watch failed[\s\S]*Failure: could not start condition: ENOENT/);
});

test('Esc and other session events never cancel a watch; deletion forgets it', async (t) => {
  const h = harness();
  t.after(() => h.engine.dispose());
  const watch = h.start({ action: 'start', condition: 'x', intervalSeconds: 5 });
  await h.clock.advance(0);
  h.engine.handleEvent({ type: 'session.execution.interrupted', data: { sessionID: 'ses', reason: 'user' } });
  await h.clock.advance(5000);
  assert.equal(watch.facts.status, 'running'); assert.equal(h.script.calls.length, 2);
  h.engine.handleEvent({ type: 'session.deleted', data: { sessionID: 'ses' } });
  await h.clock.advance(60000);
  assert.equal(h.script.calls.length, 2); assert.deepEqual(h.engine.list('ses'), []);
  await flush(); assert.equal(h.storage.data.size, 0);
});

test('cancel during a check aborts it and wakes nobody; unknown IDs explain the fix', async (t) => {
  const done = deferred();
  const h = harness({ results: [(signal) => { signal.addEventListener('abort', () => done.resolve({ code: 1, killed: true })); return done.promise; }] });
  t.after(() => h.engine.dispose());
  const watch = h.start({ action: 'start', condition: 'x' });
  await h.clock.advance(0);
  assert.equal(h.engine.phase('ses', watch.id), 'checking');
  h.engine.cancel('ses', watch.id);
  await flush();
  assert.equal(watch.facts.status, 'cancelled'); assert.equal(h.wakes.length, 0);
  assert.throws(() => h.engine.cancel('ses', 'nope'), /Unknown until watch in this session: nope\. Run until action=list/);
  assert.throws(() => h.engine.complete('ses', watch.id), /not recurring/);
});

test('wake=notify toasts the user and never wakes the agent', async (t) => {
  const h = harness({ results: [{ code: 0, killed: false }] });
  t.after(() => h.engine.dispose());
  h.start({ action: 'start', condition: 'x', wake: 'notify', label: 'tests' });
  await h.clock.advance(0);
  assert.equal(h.wakes.length, 0);
  assert.deepEqual(h.events.find((e) => e.name === 'notify').data, { sessionID: 'ses', title: 'until · tests', message: 'condition met', variant: 'success' });
});

test('inline start: a first check that is already true answers the tool call and wakes nobody', async (t) => {
  const h = harness({ results: [{ code: 0, killed: false }] });
  t.after(() => h.engine.dispose());
  const watch = h.start({ action: 'start', condition: 'true' }, { inline: true });
  const settled = h.engine.settleInline('ses', watch.id, 3000);
  await h.clock.advance(0);
  assert.deepEqual(await settled, { watch, answered: true });
  assert.equal(h.wakes.length, 0); assert.equal(watch.notice, undefined);
  const slow = deferred();
  h.engine.run = () => slow.promise;
  const later = h.start({ action: 'start', condition: 'slow' }, { inline: true });
  const pending = h.engine.settleInline('ses', later.id, 3000);
  await h.clock.advance(3000);
  assert.equal((await pending).answered, false);
  slow.resolve({ code: 0, killed: false }); await h.clock.advance(0);
  assert.equal(later.facts.status, 'succeeded'); assert.equal(h.wakes.length, 1, 'past the inline window, the result wakes the agent');
});

test('recurring wakes are serialized: ticks during a running follow-up become missed ticks', async (t) => {
  const h = harness();
  t.after(() => h.engine.dispose());
  const watch = h.start({ action: 'repeat', instruction: 'Review deploy', quickRef: 'R42', intervalSeconds: 60, timeoutSeconds: 3600 });
  await h.clock.advance(59999); assert.equal(h.wakes.length, 0);
  await h.clock.advance(1);
  assert.equal(h.wakes.length, 1); assert.match(h.wakes[0].text, /## Instruction\nReview deploy/);
  assert.equal(h.engine.phase('ses', watch.id), 'queued');
  h.engine.handleEvent({ type: 'session.inbox.delivered', data: { sessionID: 'ses', inboxID: h.wakes[0].id } });
  assert.equal(h.engine.phase('ses', watch.id), 'delivering');
  await h.clock.advance(150000); // two and a half intervals of agent work
  assert.equal(h.wakes.length, 1, 'no stacked wakes while the follow-up runs');
  h.engine.handleEvent({ type: 'session.execution.succeeded', data: { sessionID: 'ses' } });
  assert.equal(watch.facts.missedTicks, 2);
  await h.clock.advance(60000);
  assert.equal(h.wakes.length, 2); assert.match(h.wakes[1].text, /- Delivery: 2\n- Missed ticks: 2/);
  assert.notEqual(h.wakes[1].id, h.wakes[0].id);
  h.engine.complete('ses', watch.id);
  assert.equal(watch.facts.status, 'completed'); assert.equal(h.wakes.length, 2);
});

test('recurring gate skips ticks without waking; expiry delivers the expired packet', async (t) => {
  const h = harness({ results: [{ code: 1, killed: false }] });
  t.after(() => h.engine.dispose());
  const watch = h.start({ action: 'repeat', instruction: 'x', quickRef: 'gated', condition: 'test -f go', intervalSeconds: 60, timeoutSeconds: 200, immediate: true });
  await h.clock.advance(180000);
  assert.equal(h.script.calls.length, 4); assert.equal(h.wakes.length, 0); assert.equal(watch.facts.deliveries, 0);
  await h.clock.advance(20000);
  assert.equal(watch.facts.status, 'expired');
  assert.equal(h.wakes.length, 1); assert.match(h.wakes[0].text, /^# Recurring follow-up expired/);
});

test('wake admission retries with the same message ID; exhausted retries are visible', async (t) => {
  let attempts = 0;
  const ids = [];
  const h = harness({ results: [{ code: 0, killed: false }], synthetic: async (input) => { ids.push(input.id); if (++attempts < 3) throw new Error('transport'); } });
  t.after(() => h.engine.dispose());
  const watch = h.start({ action: 'start', condition: 'x' });
  await h.clock.advance(100);
  assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 1); assert.equal(watch.notice.state, 'sent');
  h.engine.synthetic = async () => { throw new Error('down'); };
  const lost = h.start({ action: 'start', condition: 'x' });
  await h.clock.advance(100);
  assert.equal(lost.notice.state, 'failed'); assert.equal(lost.notice.text.length > 0, true);
});

test('restore resumes this location only, skips expired, resends pending wakes with the same ID', async () => {
  const first = harness({ results: [(signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ code: 1, killed: true })))] });
  const running = first.start({ action: 'start', condition: 'x', timeoutSeconds: 600 });
  const expiring = first.start({ action: 'start', condition: 'y', timeoutSeconds: 10 });
  await first.clock.advance(0);
  await first.engine.dispose();
  assert.equal(first.storage.data.get(`watch/ses/${running.id}`).facts.status, 'running', 'unload never cancels');
  const pendingID = 'msg_000000000000pendingpending';
  await first.storage.set('watch/ses/feedface', {
    v: 1, id: 'feedface', sessionID: 'ses', location, definition: { kind: 'until', label: 'old', wake: 'agent', intervalMs: 1000, gate: { command: 'x', cwd: '/repo', checkTimeoutMs: 1000 } },
    facts: { status: 'succeeded', startedAt: 0, finishedAt: 1, attempts: 1, deliveries: 0, missedTicks: 0, reloads: 0, nextDueAt: 0 },
    notice: { messageID: pendingID, state: 'pending', text: 'wake', description: 'until · old' },
  });
  await first.storage.set('watch/other/cafebabe', { ...first.storage.data.get(`watch/ses/${running.id}`), id: 'cafebabe', sessionID: 'other', location: { directory: '/elsewhere' } });

  await first.storage.set('watch/ses/corrupt0', { v: 1, id: 'corrupt0', sessionID: 'ses', location, definition: { kind: 'until' }, facts: { status: 'running' } });

  const second = harness({ storage: first.storage, results: [{ code: 1, killed: false }] });
  await second.clock.advance(20000);
  await second.engine.restore();
  await second.clock.advance(0);
  const restored = second.engine.get('ses', running.id).watch;
  assert.equal(restored.facts.status, 'running'); assert.equal(restored.facts.reloads, 1);
  assert.equal(second.script.calls.length, 1, 'the restored watch keeps checking');
  assert.equal(second.engine.get('ses', expiring.id).watch.facts.status, 'timedOut');
  assert.throws(() => second.engine.get('ses', 'corrupt0'), /Unknown/, 'malformed records are never run');
  const wakes = Object.fromEntries(second.wakes.map((w) => [w.metadata?.watchID ?? 'feedface', w]));
  assert.equal(wakes.feedface.id, pendingID, 'the pending wake is resent with its own ID');
  assert.match(wakes[expiring.id].text, /^The watch timed out/, 'an agent waiting on a deadline that passed while down is told');
  assert.equal(second.wakes.length, 2);
  assert.throws(() => second.engine.get('other', 'cafebabe'), /Unknown/);
  assert.deepEqual(second.telemetry.filter((e) => e.event === 'resumed'), [{ sessionID: 'ses', event: 'resumed', count: 1 }]);
  await second.engine.dispose();
});

test('restore drops watches of sessions that no longer exist', async () => {
  const first = harness();
  const watch = first.start({ action: 'start', condition: 'x' });
  await first.engine.dispose();
  const second = harness({ storage: first.storage, sessionExists: async () => false });
  await second.engine.restore(); await flush();
  assert.equal(second.storage.data.has(`watch/ses/${watch.id}`), false);
  await second.engine.dispose();
});

test('a wake admitted while unloading drains is saved as sent, so the next generation does not resend it', async () => {
  const admit = deferred();
  const h = harness({ results: [{ code: 0, killed: false }], synthetic: () => admit.promise });
  const watch = h.start({ action: 'start', condition: 'x' });
  await h.clock.advance(0);
  const unloading = h.engine.dispose();
  admit.resolve();
  await unloading;
  assert.equal(h.storage.data.get(`watch/ses/${watch.id}`).notice.state, 'sent');
});

test('an in-flight recurring wake survives a restart: resent with its ID, settled when idle, never stacked', async () => {
  const first = harness();
  const watch = first.start({ action: 'repeat', instruction: 'Check', quickRef: 'C', intervalSeconds: 60, timeoutSeconds: 3600, immediate: true });
  await first.clock.advance(0);
  assert.equal(first.wakes.length, 1);
  await first.engine.dispose();
  const stored = first.storage.data.get(`watch/ses/${watch.id}`);
  assert.equal(stored.delivery.messageID, first.wakes[0].id); assert.match(stored.delivery.text, /## Instruction\nCheck/);

  const idle = deferred();
  const second = harness({ storage: first.storage });
  second.engine.waitIdle = (sessionID, signal) => { assert.equal(sessionID, 'ses'); assert.ok(signal); return idle.promise; };
  await second.engine.restore();
  await second.clock.advance(180000);
  assert.deepEqual(second.wakes.map((w) => w.id), [first.wakes[0].id], 'resent once with the same ID; no stacked ticks while unsettled');
  idle.resolve(); await flush();
  const restored = second.engine.get('ses', watch.id).watch;
  assert.equal(restored.delivery, undefined);
  assert.equal(restored.facts.missedTicks, 3, 'ticks due at +60s, +120s and +180s passed while the wake ran');
  await second.clock.advance(60000);
  assert.equal(second.wakes.length, 2);
  await second.engine.dispose();
});

test('per-session limit and bounded history', async (t) => {
  const h = harness();
  t.after(() => h.engine.dispose());
  for (let i = 0; i < 32; i++) h.start({ action: 'start', condition: 'x' });
  assert.throws(() => h.start({ action: 'start', condition: 'x' }), /At most 32 active/);
  for (const w of h.engine.list('ses')) h.engine.cancel('ses', w.id);
  for (let i = 0; i < 30; i++) h.engine.cancel('ses', h.start({ action: 'start', condition: 'x' }).id);
  assert.equal(h.engine.list('ses').length, 50);
});
