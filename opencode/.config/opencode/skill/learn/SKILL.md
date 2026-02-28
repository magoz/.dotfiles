---
name: learn
description: Capture patterns from the current session and audit AGENTS.md files against the actual codebase. Keeps documentation current as code evolves.
---

# Learn Skill (Code)

Maintain AGENTS.md knowledge base by capturing session learnings and auditing existing documentation against the actual codebase.

## Workflow

### 1. Read Existing Documentation

Read root `AGENTS.md` and follow pointers to all subdirectory AGENTS.md files. Build a map of what's documented.

If no `AGENTS.md` exists at root, note it — you'll create one at the end.

### 2. Capture Session Learnings

Review the current conversation and recent changes. Extract anything worth persisting:

**Patterns & conventions:**

- New patterns introduced (e.g., "server actions follow this structure")
- Naming conventions that emerged (e.g., "files ending in `-action.ts`")
- Import patterns, file organization decisions
- Error handling approaches chosen

**Architectural decisions:**

- Why a particular approach was chosen over alternatives
- Tradeoffs that were considered
- Constraints discovered (framework limitations, API quirks)

**Anti-patterns:**

- Approaches that were tried and rejected
- Things that broke and why
- Patterns explicitly forbidden ("never use X because Y")

**Code map updates:**

- New key symbols (services, components, important functions)
- Files that moved or were renamed
- New directories with significant code

### 3. Audit Existing AGENTS.md

Walk each documented AGENTS.md and verify against the actual codebase:

**Code maps:**

- Do referenced files still exist at those paths?
- Do referenced symbols (functions, classes, types) still exist?
- Are line numbers still approximately correct?
- Are new important symbols missing from the map?

**WHERE TO LOOK tables:**

- Do the referenced locations still match?
- Are there new common tasks not covered?

**Patterns & conventions:**

- Do documented patterns still match how the code actually works?
- Are there anti-patterns listed that are no longer relevant?
- Have conventions changed without the docs being updated?

**Structure sections:**

- Does the documented directory structure match reality?
- Are there new important directories not mentioned?

**Subdirectory coverage:**

- Are there directories with significant complexity that lack AGENTS.md?
- Only flag directories that would genuinely confuse a future session — not every directory needs documentation.

### 4. Update AGENTS.md Files

Apply both captured learnings and audit fixes:

**When updating existing files:**

- Preserve existing structure and style
- Make surgical edits — don't rewrite entire sections
- Update stale entries inline (fix paths, rename symbols, correct patterns)
- Add new entries where they fit (new rows in tables, new items in lists)
- Remove entries only when the referenced code is clearly gone

**When creating new AGENTS.md files:**

- Only for directories with genuine complexity (multiple files, non-obvious patterns)
- Keep them lean — 30-80 lines max
- Never repeat what the parent AGENTS.md already covers
- Follow the existing style in the project's other AGENTS.md files

**When updating root AGENTS.md:**

- Add new subdirectory pointers if you created new AGENTS.md files
- Update the SUBDIRECTORY DOCS section

### 5. Commit

```bash
git add -A
git commit -m "docs: update AGENTS.md from session"
git push
```

## Scope Control

- `/learn` — full pass: capture session learnings + audit all AGENTS.md
- `/learn [area]` — focused on a specific area (e.g., `/learn lib/services`)

When focused on an area, only read and update AGENTS.md files within that subtree.

## Principles

### Incremental, Not Generative

This skill **maintains** existing AGENTS.md files. It doesn't regenerate them from scratch. Think `git commit`, not `git init`. If the project needs a full AGENTS.md generation, that's a different task.

### Verify Before Removing

If something looks stale but you're not 100% sure (e.g., a symbol you can't find might be dynamically generated), leave it and add a `?` or note rather than deleting.

### Concise Updates

AGENTS.md files should be telegraphic. When adding learnings:

- Bullet points, not paragraphs
- Code examples only when the pattern isn't obvious
- One line per convention/anti-pattern
- Tables for structured data (code maps, locations)

### Don't Over-Document

Not every session produces learnings worth persisting. Not every directory needs AGENTS.md. If there's nothing meaningful to capture or fix:

> Nothing to update from this session.

## Completion

After updating, report what changed:

> **Updated AGENTS.md:**
>
> - `lib/services/AGENTS.md` — added Encryption service to code map
> - `lib/core/prd/AGENTS.md` — fixed stale webhook handler paths
> - `components/ui/AGENTS.md` — new file (5 components undocumented)
>
> **Captured:** new error handling pattern, S3 upload convention
