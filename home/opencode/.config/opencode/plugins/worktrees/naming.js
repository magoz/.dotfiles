// OpenCode's worktree `name` becomes the last path segment of the suggested
// directory (core: path.join(parent, name)), so it cannot carry a branch `/`.
// Encoding (documented in README.md, used by Fleet):
//   1. `--` separates branch segments exactly:  feat--x -> feat/x, fix--api--y -> fix/api/y.
//      This is the canonical, reversible form: branchToName('feat/x') === 'feat--x'.
//   2. Without `--`, a leading conventional type and `-` becomes `type/`:
//      feat-x -> feat/x (the TUI dialog slugifies `feat/x` to `feat-x` and can never type `--`).
//   3. Anything else gets `feat/`: brave-cabin (OpenCode's random slug) -> feat/brave-cabin.
// The CLI still validates the result with `git check-ref-format --branch`.

export const BRANCH_TYPES = ['feat', 'fix', 'chore', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'style', 'revert'];

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
// A segment between `--` separators: no leading/trailing `-`, so `---` is never ambiguous.
const SEGMENT = /^[A-Za-z0-9._](?:[A-Za-z0-9._-]*[A-Za-z0-9._])?$/;
const TYPED = new RegExp(`^(${BRANCH_TYPES.join('|')})-(.+)$`);

export function branchFromName(name) {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error('Invalid worktree name: use letters, digits, ".", "_" and "-" (encode "/" as "--")');
  if (name.includes('--')) {
    const segments = name.split('--');
    if (!segments.every((segment) => SEGMENT.test(segment))) throw new Error('Invalid worktree name: "--" must separate non-empty branch segments');
    return segments.join('/');
  }
  const typed = TYPED.exec(name);
  return typed ? `${typed[1]}/${typed[2]}` : `feat/${name}`;
}

/** Canonical name for a branch (what Fleet must send). Throws if the branch has no exact encoding. */
export function branchToName(branch) {
  const segments = typeof branch === 'string' ? branch.split('/') : [];
  if (segments.length === 0 || !segments.every((segment) => SEGMENT.test(segment) && !segment.includes('--'))) {
    throw new Error('Branch has no exact worktree name encoding');
  }
  const name = segments.join('--');
  if (!NAME.test(name) || branchFromName(name) !== branch) throw new Error('Branch has no exact worktree name encoding');
  return name;
}
