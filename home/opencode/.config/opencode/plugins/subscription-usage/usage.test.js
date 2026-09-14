import test from 'node:test';
import assert from 'node:assert/strict';
import { windows, format, allowedOrigin, makeUsage } from './usage.js';

test('normalizers never invent unused Grok allowance or expose provider strings', () => {
  assert.deepEqual(windows('xai', { config: { currentPeriod: { type: 'SECRET' } } }), []);
  const items = windows('xai', { config: { creditUsagePercent: 75, currentPeriod: { type: 'SECRET' } } });
  assert.equal(format(items), 'usage: 25% left · reset unknown');
  assert.equal(windows('anthropic', { five_hour: { utilization: 20 } })[0].left, 80);
  assert.equal(windows('openai', { rate_limit: { primary_window: { used_percent: 30, reset_at: 10 } } })[0].reset, 10000);
  assert.match(format([{ label: '5h', left: 1, reset: 1 }], 5), /reset pending/);
});
test('only supported official origins or the explicit local Claude adapter', () => {
  assert.equal(allowedOrigin('openai', { settings: { baseURL: 'https://evil.invalid' } }, {}), false);
  assert.equal(allowedOrigin('openai', { settings: { baseURL: 'https://user:secret@api.openai.com' } }, {}), false);
  assert.equal(allowedOrigin('anthropic', { api: { url: 'http://127.0.0.1:123/random/v1' } }, { methodID: 'claude-pro-max' }), true);
});
function context(credential) {
  return {
    location: { directory: '/repo' }, session: { async get() { return { id: 'ses', location: { directory: '/repo' }, model: { providerID: 'openai', id: 'model' } }; } },
    catalog: { provider: { async get() { return { data: { id: 'openai', integrationID: 'openai' } }; } }, model: { async list() { return { data: [{ id: 'model', providerID: 'openai' }] }; } } },
    integration: { connection: { async active() { return { type: 'credential', id: 'connection' }; }, async resolve() { return credential; } } },
  };
}
test('OAuth-only fixed endpoint, redirect rejection, cache, no secret output', async () => {
  let calls = 0;
  const usage = makeUsage(context({ type: 'oauth', access: 'synthetic-secret' }), { fetcher: async (url, options) => {
    calls++; assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage'); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 20 } } }));
  } });
  try {
    const result = await usage.get('ses'); assert.equal(result.status, 'available'); assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
    await usage.get('ses'); assert.equal(calls, 1);
  } finally { usage.dispose(); }
  const keyed = makeUsage(context({ type: 'key', key: 'synthetic-key' }), { fetcher: async () => assert.fail('No API key telemetry') });
  assert.equal((await keyed.get('ses')).status, 'unavailable'); keyed.dispose();
});

const success = (used = 20) => new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: used } } }));
const oauth = (accountID = 'account-a') => ({ type: 'oauth', access: 'synthetic-secret', metadata: { accountID } });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

for (const failure of ['rejection', 'timeout', 'parse', 'body', 'oversize', 'http', 'payload']) test(`same verified identity: success -> expiry -> ${failure} -> cached retry -> refresh`, async () => {
  let clock = 0, calls = 0;
  const usage = makeUsage(context(oauth()), { now: () => clock, timeoutMs: 5, fetcher: async () => {
    calls++;
    if (calls !== 2) return success(20 + calls);
    if (failure === 'rejection') throw new Error('Synthetic network error with secret');
    if (failure === 'timeout') return new Promise(() => {});
    if (failure === 'parse') return new Response('{broken');
    if (failure === 'body') return new Response(new ReadableStream({ start(controller) { controller.error(new Error('Synthetic body error')); } }));
    if (failure === 'oversize') return new Response('é'.repeat(32769));
    if (failure === 'http') return new Response('failure', { status: 503 });
    return new Response('{}');
  } });
  // AbortSignal.timeout is unref'd; retain the event loop for this offline timeout test.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const first = await usage.get('ses'); assert.equal(first.status, 'available');
    clock = 300001;
    const stale = await usage.get('ses'); assert.deepEqual(stale, { status: 'stale', text: first.text + '\n(stale)' });
    assert.deepEqual(await usage.get('ses'), stale); assert.equal(calls, 2);
    clock = 600002;
    assert.equal((await usage.get('ses')).status, 'available'); assert.equal(calls, 3);
  } finally { clearInterval(keepAlive); usage.dispose(); }
});

test('stale retention is hard-bounded from success, even through repeated failures and 429 backoff', async () => {
  const { STALE_RETENTION_MS } = await import('./usage.js');
  let clock = 0, calls = 0;
  const usage = makeUsage(context(oauth()), { now: () => clock, fetcher: async () => ++calls === 1 ? success() : new Response('', { status: 429, headers: { 'retry-after': '999999999' } }) });
  try {
    assert.equal((await usage.get('ses')).status, 'available');
    clock = 300001; assert.equal((await usage.get('ses')).status, 'stale');
    clock = STALE_RETENTION_MS - 1; assert.equal((await usage.get('ses')).status, 'stale');
    clock++; assert.equal((await usage.get('ses')).status, 'unavailable'); assert.equal(calls, 2);
    clock = 300001 + 86400000; assert.equal((await usage.get('ses')).status, 'unavailable'); assert.equal(calls, 3);
  } finally { usage.dispose(); }
});

test('auth/identity failures never expose cached data; account switch is isolated; dispose is final', async () => {
  let clock = 0, calls = 0, credential = oauth();
  const ctx = context(credential), original = ctx.session.get;
  ctx.integration.connection.resolve = async () => { if (credential instanceof Error) throw credential; return credential; };
  const usage = makeUsage(ctx, { now: () => clock, fetcher: async () => { if (++calls > 1) throw new Error('offline'); return success(); } });
  assert.equal((await usage.get('ses')).status, 'available'); clock = 300001;
  for (const invalid of [new Error('auth failed'), undefined, { type: 'key', key: 'synthetic' }, oauth('invalid account')]) {
    credential = invalid; assert.equal((await usage.get('ses')).status, 'unavailable');
  }
  credential = oauth(); ctx.session.get = async () => ({ ...await original(), location: { directory: '/other' } });
  assert.equal((await usage.get('ses')).status, 'unavailable'); ctx.session.get = original;
  credential = oauth('account-b'); assert.equal((await usage.get('ses')).status, 'unavailable');
  credential = oauth(); assert.equal((await usage.get('ses')).status, 'stale');
  usage.dispose(); assert.equal((await usage.get('ses')).status, 'unavailable'); assert.equal(calls, 3);
});

test('stream enforces byte bound while reading and cancels on oversize or abort', async () => {
  const { readBounded, MAX_RESPONSE_BYTES } = await import('./usage.js');
  let pulls = 0, cancelled = 0;
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(16384)); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  await assert.rejects(readBounded(new Response(stream), new AbortController().signal), /too large/);
  assert.equal(pulls, 5); assert.equal(cancelled, 1);
  assert.equal((await readBounded(new Response('x'.repeat(MAX_RESPONSE_BYTES)), new AbortController().signal)).length, MAX_RESPONSE_BYTES);
  const request = new AbortController();
  const body = new ReadableStream({ cancel() { cancelled++; } });
  const pending = readBounded(new Response(body), request.signal);
  request.abort(); await assert.rejects(pending); assert.equal(cancelled, 2);
});

test('RPC request abort cancels fetch/body and never returns stale or poisons retry', async () => {
  let clock = 0, calls = 0, cancelled = 0, fetchSignal;
  const usage = makeUsage(context(oauth()), { now: () => clock, fetcher: async (_url, options) => {
    calls++; fetchSignal = options.signal;
    if (calls !== 2) return success();
    return new Response(new ReadableStream({ cancel() { cancelled++; } }));
  } });
  try {
    await usage.get('ses'); clock = 300001;
    const request = new AbortController(), pending = usage.get('ses', request.signal);
    await tick(); request.abort();
    assert.equal((await pending).status, 'unavailable'); assert.equal(fetchSignal.aborted, true); assert.equal(cancelled, 1);
    assert.equal((await usage.get('ses')).status, 'available'); assert.equal(calls, 3);
  } finally { usage.dispose(); }
});

test('overlap supersedes same-session requests; older identity resolution cannot return stale', async () => {
  let calls = 0, clock = 0;
  const ctx = context(oauth()), gate = deferred();
  const usage = makeUsage(ctx, { now: () => clock, fetcher: async () => { calls++; return success(); } });
  try {
    await usage.get('ses'); clock = 300001;
    ctx.integration.connection.resolve = () => gate.promise;
    const old = usage.get('ses'); await tick();
    ctx.integration.connection.resolve = async () => { throw new Error('auth failed'); };
    assert.equal((await usage.get('ses')).status, 'unavailable');
    gate.resolve(oauth()); assert.equal((await old).status, 'unavailable'); assert.equal(calls, 1);
  } finally { usage.dispose(); }
});

test('cross-session overlap cannot overwrite newer snapshot; unload stops late completions', async () => {
  let calls = 0;
  const gate = deferred(), ctx = context(oauth());
  ctx.session.get = async ({ sessionID }) => ({ id: sessionID, location: { directory: '/repo' }, model: { providerID: 'openai', id: 'model' } });
  const usage = makeUsage(ctx, { fetcher: async () => ++calls === 1 ? gate.promise : success(70) });
  const old = usage.get('one'); await tick();
  const newer = await usage.get('two'); assert.match(newer.text, /30% left/);
  gate.resolve(success(10)); assert.equal((await old).status, 'unavailable');
  assert.deepEqual(await usage.get('two'), newer); usage.dispose();
  let signal, canceled = 0;
  const late = deferred();
  const unloading = makeUsage(context(oauth()), { fetcher: async (_url, options) => { signal = options.signal; return late.promise; } });
  const pending = unloading.get('ses'); await tick(); unloading.dispose();
  assert.equal((await pending).status, 'unavailable'); assert.equal(signal.aborted, true);
  late.resolve(new Response(new ReadableStream({ cancel() { canceled++; } })));
  await tick(); assert.equal(canceled, 1); assert.equal((await unloading.get('ses')).status, 'unavailable');
});
