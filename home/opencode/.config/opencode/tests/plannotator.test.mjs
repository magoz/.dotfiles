import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checksums, installBinary } from '../scripts/install-plannotator.mjs';
const binary = 'synthetic executable';
const checksum = createHash('sha256').update(binary).digest('hex');
for (const digest of Object.values(checksums)) assert.match(digest, /^[a-f0-9]{64}$/);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-plannotator-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, target: join(dir, 'plannotator'), checksum, url: 'https://example.invalid/binary' };
}
test('private binary install verifies bytes and is idempotent', async (t) => {
  const f = await fixture(t);
  await installBinary({ ...f, fetcher: async () => new Response(binary) });
  assert.equal(await readFile(f.target, 'utf8'), binary);
  await installBinary({ ...f, fetcher: async () => assert.fail('No second download') });
  assert.deepEqual(await readdir(f.dir), ['plannotator']);
});
test('checksum mismatch installs nothing', async (t) => {
  const f = await fixture(t);
  await assert.rejects(installBinary({ ...f, fetcher: async () => new Response('corrupt') }), /checksum/);
  assert.deepEqual(await readdir(f.dir), []);
});
test('existing/symlink and concurrent targets are preserved', async (t) => {
  const f = await fixture(t);
  await assert.rejects(installBinary({ ...f, fetcher: async () => {
    await writeFile(f.target, 'concurrent'); return new Response(binary);
  } }), /EEXIST/);
  assert.equal(await readFile(f.target, 'utf8'), 'concurrent');
  await assert.rejects(installBinary(f), /Existing binary/);
  await rm(f.target); await symlink(join(f.dir, 'absent'), f.target);
  await assert.rejects(installBinary(f), /Existing binary/);
});
