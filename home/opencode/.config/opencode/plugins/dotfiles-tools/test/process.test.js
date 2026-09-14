import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runProcess, withoutPaneEnv } from '../process.js';

const base = { cwd: process.cwd(), env: { PATH: '/bin:/usr/bin' }, timeoutMs: 3000 };

test('process runtime respects argv, drops condition output, caps captured output', async () => {
  assert.deepEqual(withoutPaneEnv({ HERDR_ENV: '1', HERDR_SOCKET: 'secret', PATH: '/bin' }), { PATH: '/bin' });
  const quiet = await runProcess('/bin/sh', ['-c', 'printf secret; printf secret >&2; exit 1'], base);
  assert.deepEqual(quiet, { code: 1, stdout: '', stderr: '' });
  const result = await runProcess('/bin/printf', ['%s', 'literal; $(false)'], { ...base, capture: 'stdout' });
  assert.equal(result.stdout, 'literal; $(false)');
  await assert.rejects(runProcess('/bin/sh', ['-c', 'printf 123456789'], { ...base, capture: 'stdout', maxBytes: 4 }), /output exceeded/);
});

test('timeout and cancellation are bounded; missing command is sanitized', async () => {
  await assert.rejects(runProcess('/bin/sh', ['-c', 'sleep 30'], { ...base, timeoutMs: 20 }), /timed out/);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => runProcess('/bin/true', [], { ...base, signal: controller.signal }));
  await assert.rejects(runProcess('/not-a-real-command', [], base), /Unable to start process/);
});

async function processes() {
  const result = [];
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = await readFile(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      result.push({ pid: Number(name), state: fields[0], parent: Number(fields[1]), group: Number(fields[2]), command: await readFile(`/proc/${name}/cmdline`, 'utf8') });
    } catch { /* process already gone */ }
  }
  return result;
}

test('SIGKILL grace stays referenced after leader exit and kills resistant descendants', { skip: process.platform !== 'linux' }, async () => {
  const marker = `dotfiles-process-test-${randomUUID()}`;
  const controller = new AbortController();
  const pending = runProcess('/bin/sh', ['-c', 'sh -c \'trap "" TERM; while :; do sleep 1; done\' & wait', marker], { ...base, timeoutMs: 10000, signal: controller.signal });
  const rejected = assert.rejects(pending, /cancelled/);
  let leader, children = [];
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const snapshot = await processes();
      leader = snapshot.find((item) => item.command.includes(marker));
      children = leader ? snapshot.filter((item) => item.parent === leader.pid) : [];
      if (children.length && snapshot.some((item) => item.parent === children[0].pid)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(leader); assert.ok(children.length);
    const start = Date.now(); controller.abort(); await rejected;
    assert.ok(Date.now() - start >= 240, 'waited through group SIGKILL grace after leader termination');
    await new Promise((resolve) => setTimeout(resolve, 20)); // Let /proc reflect exit transitions.
    const remaining = (await processes()).filter((item) => item.group === leader.pid && item.state !== 'Z');
    assert.deepEqual(remaining, []);
  } finally { controller.abort(); await rejected; }
});
