#!/usr/bin/env bun
// Binary-only, OpenCode-private install. Never run upstream host/skill installers.
// Immutable release: https://github.com/backnotprop/plannotator/releases/tag/v0.27.14
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, link, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
export const version = '0.27.14';
export const checksums = {
  'darwin-arm64': '1e9f70f454d393028f2d6fe12da8aaab931b3591fd341aad34280ff1981ea4d0',
  'darwin-x64': '8c6c93abee26e814af4b9d1d7720ca93b133eb824b8acd984ddd9c3141c61479',
  'linux-arm64': '5ebbd6d15130c2633bfa9b295312057e8277954a98f402db65eb124b31e7084d',
  'linux-x64': '95db254acb2a996eb0d83289abbb91dfce2b0ddee378b6375205e3e8251a8db0',
};
async function sha(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function installBinary({ target, checksum, url, fetcher = fetch }) {
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('Refusing symlink binary directory');
  const existing = await lstat(target).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink() || await sha(target) !== checksum) throw new Error('Existing binary differs; preserve and inspect before upgrading');
    return;
  }
  const temp = await mkdtemp(join(dir, '.plannotator-'));
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error('Binary download failed');
    const file = join(temp, 'binary');
    await pipeline(Readable.fromWeb(response.body), createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    if (await sha(file) !== checksum) throw new Error('Binary checksum mismatch');
    await chmod(file, 0o755);
    await link(file, target); // Atomic no-clobber: concurrent/existing targets are preserved.
  } finally { await rm(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const platform = `${process.platform}-${process.arch}`, checksum = checksums[platform];
  if (!checksum) throw new Error('Unsupported Plannotator platform');
  await installBinary({ checksum, target: join(homedir(), '.config/opencode/bin/plannotator'),
    url: `https://github.com/backnotprop/plannotator/releases/download/v${version}/plannotator-${platform}` });
  console.log(`OpenCode-private Plannotator ${version} installed (no shared hooks/skills changed).`);
}
