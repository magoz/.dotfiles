import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import serverPlugin, { setupServer } from '../server.js';
import { definition } from '../rpc.js';
import { eventStream, fakeClock, flush, location, memoryStorage } from './helpers.js';

const root = { id: 'ses_root', location, projectID: 'p' };

function fixture({ run = async () => ({ code: 1, killed: false }), storage = memoryStorage() } = {}) {
  const clock = fakeClock(), stream = eventStream(), wakes = [], emitted = [], telemetry = [];
  let tool, handlers, toolDisposed = false;
  const ctx = {
    location, storage, event: stream,
    session: {
      async get({ sessionID }) {
        if (sessionID === root.id) return root;
        if (sessionID === 'ses_child') return { ...root, id: sessionID, parentID: root.id, title: 'CI watcher', subpath: 'sub' };
        if (sessionID === 'ses_grand') return { ...root, id: sessionID, parentID: 'ses_child' };
        if (sessionID === 'ses_far') return { ...root, id: sessionID, location: { directory: '/elsewhere' } };
        throw new Error(`Session not found: ${sessionID}`);
      },
      async synthetic(input, options) { assert.ok(options.signal); wakes.push(input); },
      wait: () => new Promise(() => {}),
    },
    rpc: {
      async register(def, methods) {
        assert.equal(def, definition); handlers = methods;
        return { events: { emit: async (name, data) => { emitted.push({ name, data }); } }, async dispose() {} };
      },
    },
    tool: { async transform(edit) { edit({ add(value) { tool = value; } }); return { async dispose() { toolDisposed = true; } }; } },
  };
  const deps = {
    run, now: clock.now, timers: clock.timers, isDirectory: (dir) => dir === '/repo' || dir === '/repo/sub',
    telemetry: { enabled: true, filePath: '/dev/null', record: (sessionID, event) => telemetry.push({ sessionID, ...event }), flush: async () => {} },
  };
  return {
    ctx, deps, clock, stream, wakes, emitted, telemetry, storage,
    get tool() { return tool; }, get handlers() { return handlers; }, get toolDisposed() { return toolDisposed; },
    call: (input, sessionID = root.id) => tool.execute(input, { sessionID, agent: 'build', messageID: 'msg_x', id: 'call_x', signal: new AbortController().signal }),
  };
}

test('one direct `until` tool: no confirmation, hidden only where shell is denied', async (t) => {
  assert.equal(serverPlugin.id, 'dotfiles-until');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.exports['./server'], './server.js'); assert.equal(pkg.exports['./tui'], './tui.js');
  const f = fixture(); const cleanup = await setupServer(f.ctx, f.deps); t.after(cleanup);
  assert.equal(f.tool.name, 'until');
  assert.deepEqual(f.tool.options, { codemode: false, permission: 'shell' });
  assert.equal(f.tool.output, undefined);
  await assert.rejects(f.call({ action: 'list' }, 'ses_far'), /does not belong to this plugin location/);
});

test('start answers inline when already true, otherwise arms a watch and says not to poll', async (t) => {
  const results = [{ code: 0, killed: false }, { code: 1, killed: false }];
  const f = fixture({ run: async () => results.shift() ?? { code: 1, killed: false } });
  const cleanup = await setupServer(f.ctx, f.deps); t.after(cleanup);
  const pending = f.call({ action: 'start', condition: 'test -f done', label: 'ready' });
  await f.clock.advance(0);
  const inline = await pending;
  assert.match(inline.content, /^Condition is already true \(check 1, exit 0\)\. No watch remains: continue now\./);
  assert.equal(inline.metadata.until.status, 'succeeded');
  assert.equal(f.wakes.length, 0);

  const armed = f.call({ action: 'start', condition: 'test -f later', label: 'later', intervalSeconds: 10 });
  await f.clock.advance(0);
  const reply = await armed;
  assert.match(reply.content, /^Started until watch [0-9a-f]{8} \(later\)\. Checks now, then every 10s with no deadline\. .*do not poll\. First check: exit 1\./);
  const id = reply.metadata.until.id;
  assert.match((await f.call({ action: 'list' })).content, new RegExp(`${id}\\trunning\\tuntil\\tlater`));
  assert.match((await f.call({ action: 'status', id })).content, /Condition: test -f later\nCwd: \/repo/);
  assert.match((await f.call({ action: 'cancel', id })).content, /: cancelled/);
  await assert.rejects(f.call({ action: 'complete', id: 'nope' }), /Unknown until watch in this session: nope/);
  assert.deepEqual(f.telemetry.filter((e) => e.event === 'action').map((e) => `${e.source}:${e.action}`), ['tool:start', 'tool:start', 'tool:list', 'tool:status', 'tool:cancel', 'tool:complete']);
});

test('Esc does not cancel; deletion does; recurring wakes settle through session events', async (t) => {
  const f = fixture();
  const cleanup = await setupServer(f.ctx, f.deps); t.after(cleanup);
  const repeat = await f.call({ action: 'repeat', instruction: 'Check CI', quickRef: 'CI', intervalSeconds: 60, timeoutSeconds: 600, immediate: true });
  assert.match(repeat.content, /First wake after this turn, then every 60s/);
  await f.clock.advance(0);
  assert.equal(f.wakes.length, 1);
  f.stream.emit({ type: 'session.inbox.delivered', data: { sessionID: root.id, inboxID: f.wakes[0].id } });
  f.stream.emit({ type: 'session.execution.interrupted', data: { sessionID: root.id, reason: 'user' } });
  await flush();
  await f.clock.advance(60000);
  assert.equal(f.wakes.length, 2, 'Esc settled the follow-up without cancelling the recurrence');
  f.stream.emit({ type: 'session.deleted', data: { sessionID: root.id } });
  await flush();
  assert.equal((await f.call({ action: 'list' })).content, 'No until watches in this session.');
});

test('TUI RPC: list views, /until start, cancel, status; failures come back as errors', async (t) => {
  const f = fixture();
  const cleanup = await setupServer(f.ctx, f.deps); t.after(cleanup);
  const started = await f.handlers.start({ sessionID: root.id, condition: 'test -f x' });
  assert.equal(started.label, 'condition'); assert.equal(started.status, 'running');
  await f.clock.advance(0);
  const { watches } = await f.handlers.list({ sessionID: root.id });
  assert.equal(watches.length, 1); assert.equal(watches[0].phase, 'sleeping'); assert.equal(watches[0].attempts, 1);
  assert.ok(!JSON.stringify(watches).includes('test -f x'), 'UI views never carry the condition');
  assert.match((await f.handlers.status({ sessionID: root.id, id: started.id })).text, /Condition: test -f x/);
  assert.deepEqual(await f.handlers.cancel({ sessionID: root.id, id: started.id }), { id: started.id, status: 'cancelled' });
  assert.match((await f.handlers.complete({ sessionID: root.id, id: started.id })).error, /not recurring/);
  assert.ok(f.emitted.some((e) => e.name === 'changed' && e.data.sessionID === root.id));
});

test('watches survive a plugin reload: unload persists, the next generation resumes', async () => {
  const storage = memoryStorage();
  const first = fixture({ storage });
  const stop = await setupServer(first.ctx, first.deps);
  const pending = first.call({ action: 'start', condition: 'x', label: 'survivor', timeoutSeconds: 3600 });
  await first.clock.advance(0);
  const reply = await pending;
  await stop();
  assert.equal(first.toolDisposed, true);
  const second = fixture({ storage, run: async () => ({ code: 0, killed: false }) });
  const cleanup = await setupServer(second.ctx, second.deps);
  await flush();
  await second.clock.advance(30000);
  assert.equal(second.wakes.length, 1);
  assert.match(second.wakes[0].text, new RegExp(`until watch ${reply.metadata.until.id}: succeeded[\\s\\S]*Survived reloads: 1`));
  await cleanup();
});

test('a subagent can arm watches: they belong to the main session, which is woken with who armed them', async (t) => {
  const f = fixture({ run: async () => ({ code: 1, killed: false }) });
  const cleanup = await setupServer(f.ctx, f.deps); t.after(cleanup);
  const pending = f.call({ action: 'start', condition: 'test -f done', label: 'CI', timeoutSeconds: 60 }, 'ses_grand');
  await f.clock.advance(0);
  const reply = await pending;
  assert.match(reply.content, /The main session \(ses_root\) wakes, not you, .*put the watch ID and what it waits for in your result, then finish\./);
  const id = reply.metadata.until.id;
  assert.deepEqual(reply.metadata.until.armedBy, { sessionID: 'ses_grand' });
  const child = f.call({ action: 'start', condition: 'test -f x' }, 'ses_child');
  await f.clock.advance(0);
  assert.equal((await child).metadata.until.cwd, '/repo/sub', 'the condition runs in the subagent session directory');
  assert.match((await f.call({ action: 'list' })).content, new RegExp(`${id}\\trunning.*\\tby=ses_grand`), 'the main session sees and manages it');
  assert.match((await f.call({ action: 'list' }, 'ses_child')).content, new RegExp(id), 'so does any session in the family');
  await f.clock.advance(60000);
  const wake = f.wakes.find((w) => w.metadata.watchID === id);
  assert.equal(wake.sessionID, root.id, 'the wake goes to the main session, never the finished subagent');
  assert.match(wake.text, /Armed by: subagent session ses_grand/);
  assert.match(wake.description, /from subagent$/);
  assert.match((await f.call({ action: 'status', id: (await child).metadata.until.id })).content, /Armed by: subagent session ses_child \(CI watcher\)/);
  const rpcList = await f.handlers.list({ sessionID: 'ses_child' });
  assert.equal(rpcList.watches.length, 2);
  assert.deepEqual(await f.handlers.cancel({ sessionID: 'ses_child', id: (await child).metadata.until.id }), { id: (await child).metadata.until.id, status: 'cancelled' });
});
