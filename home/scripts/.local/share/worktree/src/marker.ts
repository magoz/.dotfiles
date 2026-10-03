import { readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"

/**
 * Ownership marker for checkouts created by `worktree checkout`.
 *
 * Lives in the linked worktree's PRIVATE git dir (`git rev-parse --absolute-git-dir`
 * inside the checkout, i.e. `<common>/worktrees/<id>/dotfiles-worktree`): never in the
 * working tree, never tracked, and deleted by `git worktree remove` with the rest of
 * that directory. Herdr/Pi worktrees and plain `git worktree add` checkouts have no
 * marker, so the Herdr-free list/retire paths never claim them.
 */
export const MARKER_FILE = "dotfiles-worktree"

export interface WorktreeMarker {
  readonly strategy: "dotfiles"
  readonly branch: string
  readonly createdAt: string
}

export const markerPath = (gitDir: string) => join(gitDir, MARKER_FILE)

/** Exclusive create (`wx`): never overwrite an existing marker. */
export const writeMarker = (gitDir: string, branch: string, now: Date = new Date()) => {
  const marker: WorktreeMarker = { strategy: "dotfiles", branch, createdAt: now.toISOString() }
  writeFileSync(markerPath(gitDir), JSON.stringify(marker) + "\n", { flag: "wx", mode: 0o644 })
  return marker
}

/** The marker for `gitDir`, or undefined when absent/unreadable/malformed (= not owned). */
export const readMarker = (gitDir: string): WorktreeMarker | undefined => {
  if (!isAbsolute(gitDir)) return undefined
  let parsed: unknown
  try {
    const content = readFileSync(markerPath(gitDir), "utf8")
    if (content.length > 4096) return undefined
    parsed = JSON.parse(content)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const strategy = "strategy" in parsed ? parsed.strategy : undefined
  const branch = "branch" in parsed ? parsed.branch : undefined
  const createdAt = "createdAt" in parsed ? parsed.createdAt : undefined
  if (strategy !== "dotfiles" || typeof branch !== "string" || branch.length === 0 || typeof createdAt !== "string") return undefined
  return { strategy, branch, createdAt }
}
