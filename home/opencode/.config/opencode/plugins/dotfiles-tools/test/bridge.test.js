import test from 'node:test';
import assert from 'node:assert/strict';
import { Bridge } from '../bridge.js';
import { request, destination } from './helpers.js';

const client = { clientID: 'client', rootID: request.rootID };
test('requires one exact live root, claims once, validates completion correlation', async (t) => {
  const bridge = new Bridge(); t.after(() => bridge.dispose());
  await assert.rejects(bridge.request(request, 1000), /Exactly one/);
  bridge.pulse({ ...client, rootID: 'other' });
  await assert.rejects(bridge.request(request, 1000), /Exactly one/);
  bridge.pulse(client);
  const pending = bridge.request(request, 1000);
  const claim = bridge.pulse(client).request;
  assert.ok(claim); assert.equal(bridge.pulse(client).request, null);
  const complete = { ...client, id: claim.id, outcome: { status: 'ready', destination, sourceRetained: true } };
  assert.equal(bridge.complete({ ...complete, clientID: 'wrong' }).acknowledged, false);
  assert.throws(() => bridge.complete({ ...complete, outcome: { status: 'ready', destination: { ...destination, branch: 'wrong' }, sourceRetained: true } }), /branch/);
  assert.equal(bridge.complete(complete).acknowledged, true);
  assert.equal((await pending).status, 'ready');
  assert.equal(bridge.complete(complete).acknowledged, false);
});

test('second client cancels in-flight and ambiguity fails closed', async (t) => {
  const bridge = new Bridge(); t.after(() => bridge.dispose());
  bridge.pulse(client);
  const pending = bridge.request(request, 1000); const rejected = assert.rejects(pending, /ambiguous/);
  bridge.pulse(client); bridge.pulse({ ...client, clientID: 'second' });
  await rejected;
  await assert.rejects(bridge.request(request, 1000), /Exactly one/);
});

test('lease expiry, release, interruption and unload cancel only current requests', async (t) => {
  let now = 100;
  const bridge = new Bridge({ now: () => now, leaseMs: 100 }); t.after(() => bridge.dispose());
  bridge.pulse(client);
  let pending = bridge.request(request, 1000), rejected = assert.rejects(pending);
  now = 201; bridge.sweep(); await rejected;
  bridge.pulse(client);
  pending = bridge.request(request, 1000); rejected = assert.rejects(pending);
  bridge.release(client); await rejected;
  now = 300; bridge.pulse(client);
  pending = bridge.request(request, 1000);
  bridge.cancelSession(rootID(), 299); // Old event cannot poison this operation.
  assert.equal(bridge.requests.size, 1);
  rejected = assert.rejects(pending); bridge.cancelSession(rootID(), 300); await rejected;
  bridge.pulse(client);
  pending = bridge.request(request, 1000); rejected = assert.rejects(pending);
  bridge.dispose(); await rejected;
  await assert.rejects(bridge.request(request, 1000), /unavailable/);
});
function rootID() { return request.rootID; }

test('expired claims never execute late approval', async (t) => {
  let now = 0;
  const bridge = new Bridge({ now: () => now }); t.after(() => bridge.dispose());
  bridge.pulse(client);
  const pending = bridge.request({ ...request, kind: 'until' }, 1000), rejected = assert.rejects(pending);
  const claim = bridge.pulse(client).request;
  now = 1001;
  assert.equal(bridge.complete({ ...client, id: claim.id, outcome: { status: 'approved' } }).acknowledged, false);
  await rejected;
});
