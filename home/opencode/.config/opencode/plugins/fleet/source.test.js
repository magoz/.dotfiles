import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetSource, createSseParser } from './source.js';
import { reconnectDelay } from './fleet.js';
import { NOW, change, fakeFetch, fakeTimers, flush, wireLaunch, wireRow, wireSnapshot } from './fixtures.js';

test('SSE parser: split chunks, CRLF, comments, multi-line data, default event', () => {
  const events = [];
  const parser = createSseParser((e) => events.push(e));
  parser.push(': heartbeat\n\nevent: fleet.cha');
  parser.push('nged\r\ndata: {"a":\r\ndata: 1}\r\n\r\ndata: x\n');
  parser.push('\n');
  assert.deepEqual(events, [{ event: 'fleet.changed', data: '{"a":\n1}' }, { event: 'message', data: 'x' }]);
});

test('snapshot on start, refetch on initial, apply changes, no credentials sent', async () => {
  const f = fakeFetch(), timers = fakeTimers(), updates = [];
  const source = createFleetSource({ baseURL: 'https://fleet.test', fetch: f.fetch, timers, onUpdate: (u) => updates.push(u) });
  source.start(); await flush();
  assert.deepEqual(f.calls.map((c) => c.url), ['https://fleet.test/api/fleet', 'https://fleet.test/api/fleet/events']);
  assert.ok(f.calls.every((c) => c.options.credentials === 'omit' && !('authorization' in c.options.headers)));
  assert.equal(source.status, 'connecting');
  assert.equal(source.live.rows.get('w').state, 'working');
  f.setSnapshot(wireSnapshot([wireRow('w', 'working'), wireRow('n', 'blocked')]));
  f.streams[0].send(change({ initial: true })); await flush();
  assert.equal(f.calls.length, 3);
  assert.equal(source.status, 'live');
  assert.equal(source.live.rows.size, 2);
  f.streams[0].send(change({ initial: false, rows: [wireRow('w', 'finished', { activeAt: NOW })], removed: ['n'] })); await flush();
  assert.deepEqual([...source.live.rows.values()].map((r) => r.state), ['finished']);
  f.streams[0].send(change({ initial: false, launches: [wireLaunch({ status: 'ready', sessionID: 'w' })] })); await flush();
  assert.deepEqual(source.live.launches.map((l) => [l.status, l.sessionID]), [['ready', 'w']]);
  assert.deepEqual(updates.map((u) => u.reason), ['snapshot', 'snapshot', 'status', 'change', 'change']);
  source.stop();
});

test('reconnect with backoff, unreachable after 3 failures, recovers on initial', async () => {
  const f = fakeFetch(), timers = fakeTimers();
  const source = createFleetSource({ baseURL: 'https://fleet.test', fetch: f.fetch, timers, onUpdate: () => {} });
  source.start(); await flush();
  f.streams[0].send(change({ initial: true })); await flush();
  assert.equal(source.status, 'live');
  f.setDown(true);
  f.streams[0].close(); await flush();
  assert.equal(source.status, 'reconnecting');
  assert.ok(timers.delays().includes(reconnectDelay(0)));
  await timers.run(1000); await timers.run(2000);
  assert.equal(source.status, 'unreachable');
  assert.deepEqual(timers.delays(), [reconnectDelay(2)]);
  f.setDown(false);
  await timers.run(4000);
  f.streams[1].send(change({ initial: true })); await flush();
  assert.equal(source.status, 'live');
  source.stop();
});

test('heartbeat watchdog aborts a silent stream; stop aborts everything and never throws', async () => {
  const f = fakeFetch(), timers = fakeTimers();
  let updates = 0;
  const source = createFleetSource({ baseURL: 'https://fleet.test', fetch: f.fetch, timers, idleTimeoutMs: 45_000,
    onUpdate: () => { updates++; throw new Error('host bug'); } });
  source.start(); await flush();
  f.streams[0].send(': heartbeat\n\n'); await flush();
  await timers.run(44_000);
  assert.equal(f.streams.length, 1);
  await timers.run(2_000);
  assert.equal(source.status, 'connecting');
  await timers.run(1_000);
  assert.equal(f.streams.length, 2);
  source.stop(); await flush();
  const before = updates;
  await timers.run(60_000);
  assert.equal(f.streams.length, 2);
  assert.equal(updates, before);
  assert.deepEqual(timers.delays(), []);
});

test('bad JSON or wrong shapes are ignored', async () => {
  const f = fakeFetch(), timers = fakeTimers();
  const source = createFleetSource({ baseURL: 'https://fleet.test', fetch: f.fetch, timers, onUpdate: () => {} });
  source.start(); await flush();
  f.streams[0].send('event: fleet.changed\ndata: {nope\n\n');
  f.streams[0].send(change({ initial: false, rows: 'x' }));
  f.streams[0].send('event: other\ndata: {}\n\n'); await flush();
  assert.equal(source.live.rows.get('w').state, 'working');
  source.stop();
});
