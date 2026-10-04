import test from 'node:test';
import assert from 'node:assert/strict';
import { branchFromName, branchToName } from '../naming.ts';

test('`--` is the exact, reversible branch separator Fleet uses', () => {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['feat--x', 'feat/x'],
    ['fix--api--retry-2', 'fix/api/retry-2'],
    ['magoz--spike', 'magoz/spike'],
    ['feat--v1.2_x', 'feat/v1.2_x'],
  ];
  for (const [name, branch] of pairs) {
    assert.equal(branchFromName(name), branch);
    assert.equal(branchToName(branch), name);
  }
});

test('names without `--`: conventional type prefix, otherwise feat/', () => {
  assert.equal(branchFromName('feat-x'), 'feat/x'); // TUI slugify of "feat/x"
  assert.equal(branchFromName('fix-login-loop'), 'fix/login-loop');
  assert.equal(branchFromName('chore-deps'), 'chore/deps');
  assert.equal(branchFromName('brave-cabin'), 'feat/brave-cabin'); // OpenCode random slug
  assert.equal(branchFromName('feature-x'), 'feat/feature-x');
  assert.equal(branchFromName('feat'), 'feat/feat');
  assert.equal(branchFromName('feat-x-2'), 'feat/x-2'); // OpenCode collision suffix stays in the branch
});

test('invalid names and branches without an exact encoding are refused', () => {
  for (const name of ['', '-x', 'feat---x', 'feat--', '--x', 'a/b', 'a b', 'ü', 'x'.repeat(121)]) {
    assert.throws(() => branchFromName(name), /Invalid worktree name/);
  }
  for (const branch of ['feat', 'feat-x', 'feat//x', 'feat/a--b', 'feat/-x', '']) {
    assert.throws(() => branchToName(branch), /no exact worktree name encoding/);
  }
});
