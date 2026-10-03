#!/usr/bin/env node
// Opt-in isolated integration check (not part of `npm test`): starts a THROWAWAY
// `opencode serve` (2.0.20 on PATH) that loads ONLY this plugin, then drives the
// real worktree.create / worktree.list / worktree.remove HTTP API against a temp
// repo with a local bare origin. The real `worktree` / `worktree-manage` CLIs come
// from THIS checkout; provision-env and sandbox-db are fakes. Isolation copies
// fleet/lib/services/opencode/testing/opencode-server.ts: temp HOME/XDG/TMPDIR,
// rebuilt env, random port + password, dead HTTP proxy (no model/provider calls).
// Never touches the live opencode.service, ~/.config, ~/.local or real leases.
//
//   node home/opencode/.config/opencode/plugins/worktrees/test/integration.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worktreeSource = path.resolve(pluginDirectory, '../../../../../scripts/.local/share/worktree/src');
const PROVISION_DELAY_SECONDS = Number(process.env.PROVISION_DELAY_SECONDS ?? '15');

const binary = spawnSync('sh', ['-c', 'command -v opencode'], { encoding: 'utf8' }).stdout.trim();
assert.ok(binary, 'opencode not on PATH');
const version = spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout.trim();
assert.match(version, /2\.0\.20/, `expected OpenCode 2.0.20, found ${version}`);
const bun = spawnSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).stdout.trim();
assert.ok(bun, 'bun not on PATH');
assert.ok(existsSync(path.join(worktreeSource, 'main.ts')), `missing ${worktreeSource}`);

const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'oc-worktrees-it-')));
const dirs = Object.fromEntries(['home', 'data', 'state', 'config', 'cache', 'tmp', 'work', 'bin', 'repos'].map((name) => {
  const directory = path.join(root, name); mkdirSync(directory, { recursive: true }); return [name, directory];
}));
const log = path.join(root, 'provision.log');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=T', '-c', 'user.email=t@local.invalid', '-c', 'commit.gpgSign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const script = (name, body) => { const file = path.join(dirs.bin, name); writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755); };

let child;
const output = [];
const cleanup = () => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  rmSync(root, { recursive: true, force: true });
};
process.on('exit', cleanup);

try {
  // Repository: no Vercel link, a pnpm lockfile -> install-only provisioning.
  const origin = path.join(root, 'origin.git'), producer = path.join(root, 'producer'), repo = path.join(dirs.repos, 'app');
  git(root, 'init', '--bare', '--initial-branch=main', origin);
  git(root, 'clone', '-q', origin, producer);
  writeFileSync(path.join(producer, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  git(producer, 'add', '-A'); git(producer, 'commit', '-qm', 'old'); git(producer, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, repo);
  const old = git(repo, 'rev-parse', 'HEAD');
  git(producer, 'commit', '-q', '--allow-empty', '-m', 'fresh'); git(producer, 'push', '-q', 'origin', 'main');
  const fresh = git(producer, 'rev-parse', 'HEAD');

  // Real CLIs from this checkout; fake provisioning/database tools.
  script('worktree', `exec ${JSON.stringify(bun)} ${JSON.stringify(path.join(worktreeSource, 'main.ts'))} "$@"`);
  script('worktree-manage', `exec ${JSON.stringify(bun)} ${JSON.stringify(path.join(worktreeSource, 'manage-main.ts'))} "$@"`);
  script('provision-env', `printf '%s\\n' "$*" >> ${JSON.stringify(log)}; sleep ${PROVISION_DELAY_SECONDS}`);
  script('sandbox-db', `case "$1" in list) echo '[]';; status) printf '{"status":"none","lease":"%s","worktree":"%s"}' "$6" "$3"; exit 1;; *) exit 2;; esac`);

  const configDirectory = path.join(dirs.config, 'opencode');
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(path.join(configDirectory, 'opencode.json'), JSON.stringify({ plugins: [pluginDirectory] }));

  const port = await new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
  const password = randomBytes(18).toString('base64url');
  const url = `http://127.0.0.1:${port}`;
  const env = {
    NODE_ENV: 'test', PATH: `${dirs.bin}:${process.env.PATH}`, SHELL: '/bin/sh',
    HOME: dirs.home, TMPDIR: dirs.tmp, XDG_DATA_HOME: dirs.data, XDG_STATE_HOME: dirs.state,
    XDG_CONFIG_HOME: dirs.config, XDG_CACHE_HOME: dirs.cache, OPENCODE_CONFIG_DIR: configDirectory,
    OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_PASSWORD: password,
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost',
  };
  child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: dirs.work, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));

  const authorization = `Basic ${btoa(`opencode:${password}`)}`;
  const request = async (method, pathname, body) => {
    const response = await fetch(new URL(pathname, url), { method, headers: { authorization, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10 * 60000) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };
  for (let attempt = 0; ; attempt++) {
    const ok = await fetch(new URL('/api/info', url), { headers: { authorization } }).then((r) => r.ok, () => false);
    if (ok) break;
    if (attempt > 300) throw new Error(`opencode serve did not start:\n${output.join('')}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const location = await request('GET', `/api/location?location[directory]=${encodeURIComponent(repo)}`);
  assert.equal(location.status, 200, JSON.stringify(location.body));
  const projectID = location.body.project.id;
  assert.ok(projectID, 'project id');
  const step = (message) => console.log(`ok - ${message}`);

  // 1. Fleet-style create: name = encoded branch, slow provisioning (> idle timeouts).
  let started = Date.now();
  const created = await request('POST', '/api/worktree', { projectID, name: 'feat--integration' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const destination = path.join(dirs.repos, 'app-feat-integration');
  assert.equal(created.body.directory, destination);
  assert.equal(git(destination, 'branch', '--show-current'), 'feat/integration');
  assert.equal(git(destination, 'rev-parse', 'HEAD'), fresh);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [`--repo ${destination} --skip-vercel --non-interactive`]);
  step(`worktree.create -> ${destination} on feat/integration at fresh origin tip, install-only provisioning (${Math.round((Date.now() - started) / 1000)}s)`);

  const listed = await request('GET', `/api/worktree?projectID=${encodeURIComponent(projectID)}`);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.find((entry) => entry.directory === destination), { directory: destination, strategy: 'dotfiles' });
  step('worktree.list records strategy dotfiles');

  // 2. Web-style create: random-ish name, `branch` is a starting ref (explicit base, no fetch).
  const fromRef = await request('POST', '/api/worktree', { projectID, name: 'brave-cabin', branch: 'main' });
  assert.equal(fromRef.status, 200, JSON.stringify(fromRef.body));
  const second = path.join(dirs.repos, 'app-feat-brave-cabin');
  assert.equal(fromRef.body.directory, second);
  assert.equal(git(second, 'branch', '--show-current'), 'feat/brave-cabin');
  assert.equal(git(second, 'rev-parse', 'HEAD'), old);
  step('worktree.create with branch=main -> feat/brave-cabin based on local main');

  // 3. A duplicate branch is refused before allocating anything.
  const duplicate = await request('POST', '/api/worktree', { projectID, name: 'feat--integration' });
  assert.equal(duplicate.status, 400);
  assert.match(JSON.stringify(duplicate.body), /before allocating anything/);
  step('duplicate branch -> 400 sanitized preflight error');

  // 4. Removal: force refused; dirty refused; clean retired via worktree-manage.
  const forced = await request('DELETE', '/api/worktree', { projectID, directory: second, force: true });
  assert.equal(forced.status, 400);
  assert.match(JSON.stringify(forced.body), /never force-removes/);
  writeFileSync(path.join(second, 'untracked.txt'), 'dirty');
  const dirty = await request('DELETE', '/api/worktree', { projectID, directory: second, force: false });
  assert.equal(dirty.status, 400);
  assert.match(JSON.stringify(dirty.body), /Checkout dirty or unavailable/);
  assert.ok(existsSync(second));
  rmSync(path.join(second, 'untracked.txt'));
  step('remove force=true and dirty checkout refused, checkout preserved');

  for (const directory of [destination, second]) {
    const removed = await request('DELETE', '/api/worktree', { projectID, directory, force: false });
    assert.equal(removed.status, 204, JSON.stringify(removed.body));
    assert.equal(existsSync(directory), false);
  }
  assert.match(git(repo, 'branch', '--list'), /feat\/integration/);
  const after = await request('GET', `/api/worktree?projectID=${encodeURIComponent(projectID)}`);
  assert.equal(after.body.some((entry) => entry.strategy === 'dotfiles'), false);
  const receipts = path.join(dirs.home, '.local', 'state', 'worktree-manager');
  assert.equal(execFileSync('sh', ['-c', `ls ${JSON.stringify(receipts)} | grep -c complete.jsonl`], { encoding: 'utf8' }).trim(), '2');
  step('worktree.remove retired both checkouts (branches kept, receipts archived)');
  console.log('integration: PASS');
} catch (error) {
  console.error('integration: FAIL');
  console.error(error);
  console.error('--- opencode serve output (tail) ---');
  console.error(output.join('').slice(-6000));
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    await exited; clearTimeout(timer);
  }
  cleanup();
}
