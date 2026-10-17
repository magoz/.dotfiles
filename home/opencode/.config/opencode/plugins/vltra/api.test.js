import test from 'node:test';
import assert from 'node:assert/strict';
import { createVltraApi } from './api.js';
import { fakeFetch, fakeTimers, flush, payloads } from './fixtures.js';

const BASE = 'https://vltra.test';
/** A request that only ends when aborted, like fetch. */
const hang = (options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));

test('mutations POST JSON with Vltra\'s own Origin, no credentials; ids are path-encoded', async () => {
  const net = fakeFetch();
  net.respond('POST', '/api/vltra/sessions/ses%2Fa/handled', 200, payloads.results.handled);
  net.respond('POST', '/api/vltra/sessions/ses_a/reopen', 200, payloads.results.reopen);
  net.respond('POST', '/api/vltra/launches', 200, payloads.results.launch);
  net.respond('POST', '/api/vltra/launches/launch-2/dismiss', 200, { launchID: 'launch-2' });
  net.respond('POST', '/api/vltra/checkouts/open', 200, payloads.results.opened);
  net.respond('POST', '/api/vltra/launcher/branch', 200, { branch: 'feat/palette', source: 'model' });
  const api = createVltraApi({ baseURL: `${BASE}/`.slice(0, -1), fetch: net.fetch, timers: fakeTimers() });
  assert.equal(api.origin, BASE);
  assert.deepEqual(await api.handled('ses/a'), { ok: true, value: { sessionID: 'ses_done_new', outcome: 'handled' } });
  assert.deepEqual((await api.reopen('ses_a')).value, { sessionID: 'ses_done_new', outcome: 'reopened' });
  assert.deepEqual((await api.launch({ repoDir: '/r', branch: 'feat/x', task: 'Do x', extra: 1 })).value, { launchID: 'launch-4' });
  assert.deepEqual((await api.dismiss('launch-2')).value, { launchID: 'launch-2' });
  assert.deepEqual((await api.openCheckout('/r/wt')).value, { sessionID: 'ses_retry', created: false });
  assert.deepEqual((await api.suggestBranch('Do x')).value, { branch: 'feat/palette', source: 'model' });
  const requests = net.requests();
  assert.deepEqual(requests.map((r) => [r.method, r.path, r.body]), [
    ['POST', '/api/vltra/sessions/ses%2Fa/handled', {}],
    ['POST', '/api/vltra/sessions/ses_a/reopen', {}],
    ['POST', '/api/vltra/launches', { repoDir: '/r', branch: 'feat/x', task: 'Do x' }],
    ['POST', '/api/vltra/launches/launch-2/dismiss', {}],
    ['POST', '/api/vltra/checkouts/open', { directory: '/r/wt' }],
    ['POST', '/api/vltra/launcher/branch', { task: 'Do x' }],
  ]);
  for (const r of requests) {
    assert.deepEqual(r.headers, { accept: 'application/json', 'content-type': 'application/json', origin: BASE });
    assert.deepEqual([r.options.credentials, r.options.redirect], ['omit', 'error']);
  }
});

test('reads: launcher list and run summaries are plain GETs without Origin', async () => {
  const net = fakeFetch();
  net.respond('GET', '/api/vltra/launcher', 200, payloads.launcher);
  net.respond('GET', '/api/vltra/sessions/ses_done_new/summary', 200, payloads.summary);
  const api = createVltraApi({ baseURL: BASE, fetch: net.fetch, timers: fakeTimers() });
  assert.deepEqual((await api.launcher()).value.map((e) => e.name), ['vltra', 'box', 'subs', 'anvil']);
  assert.equal((await api.summary('ses_done_new', 123)).value.answer, 'Added the palette.\nAll tests pass.');
  assert.deepEqual(net.requests().map((r) => [r.method, r.path, r.headers]), [
    ['GET', '/api/vltra/launcher', { accept: 'application/json' }],
    ['GET', '/api/vltra/sessions/ses_done_new/summary?idle=123', { accept: 'application/json' }],
  ]);
});

test('failures carry Vltra\'s message and status; a missing route, bad shapes, network and timeouts never throw', async () => {
  const net = fakeFetch(), timers = fakeTimers();
  net.respond('POST', '/api/vltra/sessions/a/handled', 409, { error: 'Only a finished session can be marked handled' });
  net.respond('POST', '/api/vltra/sessions/b/handled', 403, { error: 'Request rejected' });
  net.respond('POST', '/api/vltra/sessions/c/handled', 200, { sessionID: 'c', outcome: 'maybe' });
  net.respond('POST', '/api/vltra/sessions/slow/handled', hang);
  const api = createVltraApi({ baseURL: BASE, fetch: net.fetch, timers });
  assert.deepEqual(await api.handled('a'), { ok: false, status: 409, error: 'Only a finished session can be marked handled', missing: false });
  assert.equal((await api.handled('b')).error, 'Request rejected');
  assert.deepEqual(await api.handled('c'), { ok: false, status: 200, error: 'Unexpected answer from Vltra' });
  assert.deepEqual(await api.openCheckout('/x'), { ok: false, status: 404, error: 'Vltra answered 404', missing: true });
  const slow = api.handled('slow');
  await flush();
  await timers.run(10_000);
  assert.deepEqual(await slow, { ok: false, error: 'Vltra did not answer in time' });
  net.setDown(true);
  assert.deepEqual(await api.reopen('a'), { ok: false, error: 'Vltra is not reachable' });
  assert.deepEqual(timers.delays(), []);
});

test('the plugin lifetime aborts calls in flight and refuses new ones', async () => {
  const net = fakeFetch(), lifetime = new AbortController();
  net.respond('POST', '/api/vltra/sessions/a/handled', hang);
  const api = createVltraApi({ baseURL: BASE, fetch: net.fetch, timers: fakeTimers(), signal: lifetime.signal });
  const pending = api.handled('a');
  await flush();
  lifetime.abort();
  assert.deepEqual(await pending, { ok: false, error: 'Vltra plugin stopped' });
  assert.deepEqual(await api.reopen('a'), { ok: false, error: 'Vltra plugin stopped' });
  assert.equal(net.requests().length, 1);
});
