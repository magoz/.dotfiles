import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCheckRunner } from '../check.js';

const env = { PATH: process.env.PATH, HERDR_SOCKET: 'server-pane', HOME: process.env.HOME };

test('exit code is the verdict; cwd applies; output discarded; server Herdr identity hidden', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'until-check-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { run } = createCheckRunner({ env, shell: '/bin/sh' });
  assert.deepEqual(await run({ command: 'echo noisy; exit 3', cwd: dir, checkTimeoutMs: 5000 }), { code: 3, killed: false });
  assert.deepEqual(await run({ command: `test "$PWD" = "${dir}" && test -z "$HERDR_SOCKET"`, cwd: dir, checkTimeoutMs: 5000 }), { code: 0, killed: false });
});

test('a check past its timeout is terminated with its descendants and counts as false', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'until-check-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { run, drain } = createCheckRunner({ env, shell: '/bin/sh' });
  const marker = path.join(dir, 'late');
  const started = Date.now();
  const result = await run({ command: `(sleep 2; touch ${marker}) & sleep 5`, cwd: dir, checkTimeoutMs: 200 });
  assert.deepEqual(result, { code: 1, killed: true });
  assert.ok(Date.now() - started < 3000);
  await drain();
  await new Promise((resolve) => setTimeout(resolve, 2200));
  await assert.rejects(readFile(marker), 'the background descendant was killed with the group');
});

test('abort terminates; a missing shell rejects instead of hanging', async () => {
  const { run } = createCheckRunner({ env, shell: '/bin/sh' });
  const controller = new AbortController();
  const pending = run({ command: 'sleep 5', cwd: tmpdir(), checkTimeoutMs: 10000 }, controller.signal);
  controller.abort();
  assert.deepEqual(await pending, { code: 1, killed: true });
  const missing = createCheckRunner({ env, shell: '/nonexistent/shell' });
  await assert.rejects(missing.run({ command: 'true', cwd: tmpdir(), checkTimeoutMs: 1000 }), /could not start condition/);
});
