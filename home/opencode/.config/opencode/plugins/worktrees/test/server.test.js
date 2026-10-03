import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import plugin, { MARKER_FILE, STRATEGY_ID, createStrategy, markedBranch, parseWorktreeList, setupServer } from '../server.js';

// The worktree and worktree-manage CLIs are fakes on PATH that record argv/env.
// Git is real (temp repos). No Herdr, provisioning, databases or OpenCode server.
const roots = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=T', '-c', 'user.email=t@local.invalid', '-c', 'commit.gpgSign=false', ...args], { encoding: 'utf8' }).trim();

const FAKE = `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const name = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ name, args, cwd: process.cwd(), herdr: Object.keys(process.env).filter((k) => k.startsWith('HERDR_')), marker: process.env.PLUGIN_ENV_MARKER }) + '\\n');
process.stderr.write('SECRET_TOKEN=do-not-leak\\n');
const mode = process.env.FAKE_MODE ?? 'ok';
const out = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const branch = args[args.indexOf('--branch') + 1];
if (name === 'worktree') {
  if (mode === 'slow') setTimeout(() => {}, 60000);
  else if (mode === 'ok') out({ source: args[args.indexOf('--repo') + 1], branch, base: 'abc123', path: process.env.FAKE_PATH, warnings: ['skipped Vercel'] });
  else if (mode === 'mismatch') out({ source: '/repo', branch: 'feat/other', base: 'abc', path: process.env.FAKE_PATH, warnings: [] });
  else if (mode === 'extra') out({ source: '/repo', branch, base: 'abc', path: process.env.FAKE_PATH, warnings: [], secret: 'x' });
  else if (mode === 'preserved') { out({ status: 'failed', stage: 'provision', branch, path: process.env.FAKE_PATH, checkout: 'preserved' }); process.exit(2); }
  else if (mode === 'preflight') { out({ status: 'failed', stage: 'preflight', branch, checkout: 'none' }); process.exit(2); }
  else process.exit(2);
} else {
  const cmd = args[0];
  if (mode === 'plan-refused' && cmd === 'plan-checkout') { process.stderr.write('worktree-manage: Checkout dirty or unavailable\\n'); process.exit(2); }
  if (mode === 'retire-noisy' && cmd === 'retire-checkout') { process.stderr.write('Error: https://user:SECRET@x\\n  at stack\\n'); process.exit(2); }
  const target = args[args.indexOf('--path') + 1];
  if (cmd === 'plan-checkout') out({ path: target, releases: ['default'], token: 'a'.repeat(64) });
  else out({ status: 'retired', path: target, released: ['default'], branch: 'kept', receipt: '/r' });
}
`;

function fixture(mode = 'ok') {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'oc-worktrees-')));
  roots.push(root);
  const bin = path.join(root, 'bin'), log = path.join(root, 'calls.jsonl');
  mkdirSync(bin);
  for (const name of ['worktree', 'worktree-manage']) { writeFileSync(path.join(bin, name), FAKE); chmodSync(path.join(bin, name), 0o755); }
  const repo = path.join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'commit', '--allow-empty', '-m', 'init');
  const env = {
    PATH: `${bin}:${process.env.PATH}`, HOME: root, FAKE_LOG: log, FAKE_MODE: mode,
    FAKE_PATH: path.join(root, 'repo-feat-x'), HERDR_ENV: '1', HERDR_SOCKET: '/tmp/herdr.sock', PLUGIN_ENV_MARKER: 'service',
  };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []);
  return { root, repo, env, calls, strategy: createStrategy({ env }) };
}
const context = () => ({ signal: new AbortController().signal });
// What `worktree checkout` does: plain `git worktree add`, then the ownership marker.
const markedWorktree = (repo, branch, directory) => {
  git(repo, 'worktree', 'add', '-q', '-b', branch, directory);
  const gitDir = git(directory, 'rev-parse', '--absolute-git-dir');
  writeFileSync(path.join(gitDir, MARKER_FILE), JSON.stringify({ strategy: 'dotfiles', branch, createdAt: new Date().toISOString() }));
  return directory;
};

// Fixtures are independent temp repos; run concurrently (each CLI call waits runProcess's grace).
describe('dotfiles worktree strategy', { concurrency: true }, () => {
  test('setup registers the dotfiles strategy through worktree.transform and disposes it', async () => {
    const added = []; let disposed = 0;
    const ctx = { worktree: { async transform(edit) { edit({ add: (definition) => added.push(definition) }); return { async dispose() { disposed += 1; } }; } } };
    const cleanup = await setupServer(ctx, { env: {} });
    assert.equal(added.length, 1);
    assert.equal(added[0].id, STRATEGY_ID);
    assert.equal(STRATEGY_ID, 'dotfiles');
    assert.deepEqual(Object.keys(added[0]).sort(), ['create', 'id', 'list', 'remove']);
    await cleanup();
    assert.equal(disposed, 1);
    assert.equal(plugin.id, 'worktrees');
    assert.equal(typeof plugin.setup, 'function');
  });

  test('create derives the branch from the name, ignores the suggested parent and returns the CLI path', async () => {
    const f = fixture();
    const result = await f.strategy.create({ sourceDirectory: f.repo, directory: '/data/opencode/worktree/abc123/feat--x' }, context());
    assert.deepEqual(result, { directory: path.join(f.root, 'repo-feat-x') });
    const [call] = f.calls();
    assert.deepEqual(call.args, ['checkout', '--json', '--repo', f.repo, '--branch', 'feat/x']);
    assert.equal(call.cwd, f.repo);
    // Plugin process env is used (marker), minus Herdr pane identity.
    assert.equal(call.marker, 'service');
    assert.deepEqual(call.herdr, []);
  });

  test('OpenCode branch input is a starting ref passed as --base', async () => {
    const f = fixture();
    await f.strategy.create({ sourceDirectory: f.repo, directory: '/x/brave-cabin', branch: ' release/v1 ' }, context());
    assert.deepEqual(f.calls()[0].args, ['checkout', '--json', '--repo', f.repo, '--branch', 'feat/brave-cabin', '--base', 'release/v1']);
  });

  for (const [mode, pattern] of [
    ['preserved', /provision failed; preserved checkout .*repo-feat-x on branch feat\/x/],
    ['preflight', /refused feat\/x before allocating anything/],
    ['crash', /failed without a report for feat\/x/],
    ['mismatch', /invalid result for feat\/x/],
    ['extra', /invalid result for feat\/x/],
  ]) {
  test(`create failure (${mode}) throws a sanitized error`, async () => {
      const f = fixture(mode);
      await assert.rejects(f.strategy.create({ sourceDirectory: f.repo, directory: '/x/feat--x' }, context()), (error) => {
        assert.match(error.message, pattern);
        assert.doesNotMatch(error.message, /SECRET/);
        return true;
      });
    });
  }

  test('create rejects undecodable names and invalid input before running anything', async () => {
    const f = fixture();
    for (const directory of ['/x/feat---x', '/x/-x', '/x/feat--', '/x/a b']) {
      await assert.rejects(f.strategy.create({ sourceDirectory: f.repo, directory }, context()), /Invalid worktree name/);
    }
    await assert.rejects(f.strategy.create({ sourceDirectory: 'relative', directory: '/x/feat--x' }, context()), /Invalid worktree create input/);
    await assert.rejects(f.strategy.create({ sourceDirectory: f.repo, directory: '/x/feat--x', branch: ' ' }, context()), /Invalid starting ref/);
    assert.deepEqual(f.calls(), []);
  });

  test('create is cancellable and cleans up the CLI process group', async () => {
    const f = fixture('slow');
    const controller = new AbortController();
    const pending = f.strategy.create({ sourceDirectory: f.repo, directory: '/x/feat--x' }, { signal: controller.signal });
    for (let i = 0; i < 200 && f.calls().length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await assert.rejects(pending, /cancelled/);
  });

  test('remove refuses force and runs Herdr-free plan then retire with the exact token', async () => {
    const f = fixture();
    const linked = path.join(f.root, 'repo-feat-x');
    markedWorktree(f.repo, 'feat/x', linked);
    await assert.rejects(f.strategy.remove({ directory: linked, force: true }, context()), /never force-removes/);
    assert.deepEqual(f.calls(), []);
    await f.strategy.remove({ directory: linked, force: false }, context());
    const calls = f.calls();
    assert.deepEqual(calls.map((call) => call.args), [
      ['plan-checkout', '--cwd', f.repo, '--path', linked],
      ['retire-checkout', '--cwd', f.repo, '--path', linked, '--confirm', linked, '--expect-plan', 'a'.repeat(64)],
    ]);
    assert.ok(calls.every((call) => call.cwd === f.repo && call.herdr.length === 0));
  });

  test('remove surfaces only sanitized worktree-manage refusals', async () => {
    const refused = fixture('plan-refused');
    const linked = path.join(refused.root, 'repo-feat-x');
    markedWorktree(refused.repo, 'feat/x', linked);
    await assert.rejects(refused.strategy.remove({ directory: linked, force: false }, context()), /Retirement refused .*: Checkout dirty or unavailable\. Checkout preserved\./);
    assert.equal(refused.calls().length, 1);

    const noisy = fixture('retire-noisy');
    const other = path.join(noisy.root, 'repo-feat-x');
    markedWorktree(noisy.repo, 'feat/x', other);
    await assert.rejects(noisy.strategy.remove({ directory: other, force: false }, context()), (error) => {
      assert.match(error.message, /Retirement stopped .*: unknown refusal\. Inspect/);
      assert.doesNotMatch(error.message, /SECRET|https/);
      return true;
    });
  });

  test('list owns only marked worktrees on their recorded branch; others are unowned roots', async () => {
    const f = fixture();
    const linked = markedWorktree(f.repo, 'feat/x', path.join(f.root, 'repo-feat-x'));
    const plain = path.join(f.root, 'repo-herdr'), gone = path.join(f.root, 'repo-gone'), moved = path.join(f.root, 'repo-moved');
    git(f.repo, 'worktree', 'add', '-q', '-b', 'herdr', plain); // Herdr/Pi-style: no marker
    markedWorktree(f.repo, 'gone', gone);
    rmSync(gone, { recursive: true, force: true });
    markedWorktree(f.repo, 'feat/moved', moved);
    git(moved, 'switch', '-q', '-c', 'elsewhere'); // marker names another branch
    assert.deepEqual(await f.strategy.list(f.repo, context()), [
      { directory: f.repo, type: 'root' },
      { directory: linked, type: 'worktree' },
      { directory: plain, type: 'root' },
      { directory: moved, type: 'root' },
    ]);
    // From a linked checkout the primary stays the root.
    assert.deepEqual((await f.strategy.list(linked, context()))[0], { directory: f.repo, type: 'root' });
    assert.throws(() => parseWorktreeList('HEAD abc\0\0'), /Unexpected/);
    assert.equal(markedBranch(linked), 'feat/x');
    assert.equal(markedBranch(plain), undefined);
    assert.equal(markedBranch(f.repo), undefined); // primary: .git is a directory
  });

  test('remove refuses an unmarked worktree without running worktree-manage', async () => {
    const f = fixture();
    const plain = path.join(f.root, 'repo-plain');
    git(f.repo, 'worktree', 'add', '-q', '-b', 'plain', plain);
    await assert.rejects(f.strategy.remove({ directory: plain, force: false }, context()), /not a dotfiles worktree \(no ownership marker\)/);
    await assert.rejects(f.strategy.remove({ directory: f.repo, force: false }, context()), /no ownership marker/);
    assert.deepEqual(f.calls(), []);
    assert.ok(existsSync(plain));
  });
});
