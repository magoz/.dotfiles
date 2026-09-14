import test from 'node:test';
import assert from 'node:assert/strict';
import { UntilJobs, untilOptions } from '../until.js';
import { deferred, flush } from './helpers.js';

function harness(run, synthetic = async () => {}) {
  let now = 100; const timers = new Map(); let sequence = 0;
  const jobs = new UntilJobs({
    run, synthetic, env: { HERDR_ENV: '1', HERDR_SOCKET: 'server', HERDR_PANE_ID: 'pane', PATH: '/bin' }, now: () => now,
    schedule(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    unschedule(id) { timers.delete(id); },
  });
  return { jobs, timers, setNow(value) { now = value; } };
}
const options = { action: 'start', command: 'test -f ready', intervalMs: 1000, timeoutMs: 500, runtimeMs: 10000 };

test('until validates command and all bounds before scheduling', () => {
  for (const input of [{ action: 'start' }, { ...options, intervalMs: 1 }, { ...options, runtimeMs: 86400001 }, { ...options, timeoutMs: 11000 }, { ...options, id: 'chosen' }, { ...options, cwd: '/evil' }]) assert.throws(() => untilOptions(input));
  assert.equal(untilOptions({ action: 'start', command: 'true' }).intervalMs, 5000);
});

test('exit checks discard output, strip pane env and enqueue exactly once with resume/queue', async (t) => {
  const wake = []; let checks = 0;
  const h = harness(async (cmd, args, processOptions) => {
    assert.equal(cmd, '/bin/sh'); assert.deepEqual(args, ['-c', options.command]);
    assert.deepEqual(processOptions.env, { PATH: '/bin' }); assert.equal(processOptions.capture, 'none');
    checks++; return { code: checks === 1 ? 1 : 0, stdout: 'TOP SECRET', stderr: 'TOP SECRET' };
  }, async (input) => { wake.push(input); });
  t.after(() => h.jobs.dispose());
  const view = h.jobs.start('session', '/repo', options), job = h.jobs.owned('session', view.id);
  await h.jobs.check(job); assert.equal(job.state, 'running'); assert.equal(wake.length, 0);
  assert.ok([...h.timers.values()].some((timer) => timer.ms === 1000));
  await h.jobs.check(job); await h.jobs.check(job);
  assert.equal(wake.length, 1); assert.equal(job.state, 'succeeded');
  assert.equal(wake[0].sessionID, 'session'); assert.equal(wake[0].delivery, 'queue'); assert.equal(wake[0].resume, true);
  assert.match(wake[0].id, /^msg_/);
  assert.ok(!JSON.stringify([wake, h.jobs.list('session')]).includes('SECRET'));
  assert.ok(!JSON.stringify(h.jobs.list('session')).includes(options.command));
});

test('cancel during check aborts and never wakes; ownership and old event isolation', async (t) => {
  const done = deferred(); let signal;
  const h = harness(async (_c, _a, processOptions) => { signal = processOptions.signal; return done.promise; }, async () => assert.fail('no wake'));
  t.after(() => h.jobs.dispose());
  const view = h.jobs.start('owner', '/repo', options), job = h.jobs.owned('owner', view.id);
  assert.throws(() => h.jobs.cancel('other', view.id), /Unknown/);
  assert.deepEqual(h.jobs.list('other'), []);
  const check = h.jobs.check(job);
  h.jobs.cancelSession('owner', 99); assert.equal(signal.aborted, false);
  h.jobs.cancel('owner', view.id); assert.equal(signal.aborted, true);
  done.resolve({ code: 0 }); await check;
  assert.equal(job.state, 'cancelled');
});

test('deadlines and check errors stop, synthetic failure never retries', async (t) => {
  let wakes = 0;
  const h = harness(async () => ({ code: 0 }), async () => { wakes++; throw new Error('secret transport error'); });
  t.after(() => h.jobs.dispose());
  const view = h.jobs.start('owner', '/repo', options), job = h.jobs.owned('owner', view.id);
  await h.jobs.check(job); await h.jobs.check(job);
  assert.equal(job.state, 'wake_failed'); assert.equal(wakes, 1);
  const expired = h.jobs.owned('owner', h.jobs.start('owner', '/repo', options).id);
  h.setNow(10100); await h.jobs.check(expired); assert.equal(expired.state, 'expired');
  h.jobs.run = async () => { throw new Error('secret process error'); };
  const failed = h.jobs.owned('owner', h.jobs.start('owner', '/repo', options).id);
  await h.jobs.check(failed); assert.equal(failed.state, 'failed');
  assert.ok(!JSON.stringify(h.jobs.list('owner')).includes('secret'));
});

test('delete/unload cancel timers and processes, job admission bounded', async () => {
  const h = harness(async () => ({ code: 1 }));
  for (let i = 0; i < 8; i++) h.jobs.start('owner', '/repo', options);
  assert.throws(() => h.jobs.start('owner', '/repo', options), /8 active/);
  h.jobs.deleteSession('owner'); assert.equal(h.timers.size, 0); assert.deepEqual(h.jobs.list('owner'), []);
  h.jobs.start('owner', '/repo', options); h.jobs.dispose();
  assert.equal(h.timers.size, 0); assert.throws(() => h.jobs.start('owner', '/repo', options), /unavailable/);
  await flush();
});
