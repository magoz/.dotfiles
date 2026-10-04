import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTelemetry, readTelemetry, summarize, summaryText, telemetryOptions } from '../telemetry.js';

test('options follow XDG state and env overrides', () => {
  assert.deepEqual(telemetryOptions({ XDG_STATE_HOME: '/s' }), { enabled: true, filePath: '/s/opencode/until/events.jsonl' });
  assert.deepEqual(telemetryOptions({ OPENCODE_UNTIL_TELEMETRY: '0', OPENCODE_UNTIL_TELEMETRY_FILE: '/x.jsonl' }), { enabled: false, filePath: '/x.jsonl' });
});

test('appends local JSONL and summarizes like /until-stats', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'until-telemetry-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'nested', 'events.jsonl');
  const sink = createTelemetry({ filePath, now: () => 0 });
  sink.record('a', { event: 'started', kind: 'until', wake: 'agent', resumed: false });
  sink.record('a', { event: 'finished', status: 'succeeded', attempts: 3, durationMs: 4000 });
  sink.record('b', { event: 'started', kind: 'recurring', wake: 'agent', resumed: true });
  sink.record('b', { event: 'resumed', count: 1 });
  sink.record('b', { event: 'action', action: 'start', source: 'tool' });
  await sink.flush();
  assert.match(await readFile(filePath, 'utf8'), /^\{"event":"started".*"at":"1970-01-01T00:00:00.000Z","sessionID":"a","v":1\}\n/);
  const summary = summarize(await readTelemetry(filePath));
  assert.deepEqual({ ...summary }, {
    actions: { 'tool:start': 1 }, byStatus: { succeeded: 1 }, byWake: { agent: 1 }, byKind: { until: 1 },
    finished: 1, started: 1, resumed: 1, sessions: 2, medianAttempts: 3, medianDurationMs: 4000,
  });
  assert.match(summaryText(summary, filePath), /Watches started: 1 {2}finished: 1\nBy kind: until=1/);
  const off = createTelemetry({ enabled: false, filePath: path.join(dir, 'off.jsonl') });
  off.record('a', { event: 'action', action: 'list', source: 'tool' }); await off.flush();
  await assert.rejects(readFile(path.join(dir, 'off.jsonl')));
});
