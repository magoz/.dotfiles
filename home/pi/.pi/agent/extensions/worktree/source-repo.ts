import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

export type SourceRepo = {
  /** Checkout used as `--repo` and as the working directory for provisioning commands. */
  readonly repo: string;
  /** Set when the session directory no longer exists and a sibling primary checkout was used. */
  readonly recoveredFrom?: string;
};

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const nearestExistingAncestor = (path: string): string | undefined => {
  let current = dirname(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return current;
};

/**
 * Resolve the source checkout for worktree creation.
 *
 * A session whose own linked worktree was removed (for example by PR merge cleanup) keeps a
 * deleted cwd. The shared worktree CLI always places linked checkouts beside the primary
 * repository as `<primary>-<slug>`, so the deleted checkout's name identifies its primary: the
 * longest sibling name `<name>` for which the deleted directory is `<name>-…` and whose `.git`
 * is a directory (a primary checkout, never another linked worktree).
 */
export function resolveSourceRepo(cwd: string): SourceRepo {
  if (existsSync(cwd)) return { repo: cwd };

  const parent = nearestExistingAncestor(cwd);
  const missing = parent === undefined ? undefined : relative(parent, cwd).split(sep)[0];

  const primaries =
    parent === undefined || missing === undefined || missing === ""
      ? []
      : readdirSync(parent, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && missing.startsWith(`${entry.name}-`))
          .map(entry => join(parent, entry.name))
          .filter(candidate => isDirectory(join(candidate, ".git")))
          .sort((left, right) => basename(right).length - basename(left).length);

  const primary = primaries[0];
  if (primary === undefined) {
    throw new Error(
      `This session's directory no longer exists (${cwd}), and no sibling primary checkout ` +
        "named like its prefix was found. Start Pi in the primary checkout and retry.",
    );
  }

  return { repo: primary, recoveredFrom: cwd };
}
