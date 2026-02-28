---
name: learn
description: Capture patterns from the current session and audit AGENTS.md files against the actual codebase. Keeps documentation current as code evolves.
---

# Learn Skill (Code)

Maintain AGENTS.md knowledge base by capturing session learnings and auditing existing documentation against the actual codebase.

## Core Philosophy

Every token in AGENTS.md loads on **every request**, regardless of relevance. Agents can follow ~150-200 instructions reliably. This creates a hard budget:

- **Root AGENTS.md should be as small as possible** — only what's relevant to every task
- **Progressive disclosure** — point to detail files, don't inline them. Agents navigate hierarchies efficiently.
- **Capabilities over structure** — describe what the project can do, not its file tree. Agents discover structure via filesystem; file trees go stale fast.
- **Stale docs poison context** — for agents, outdated info is actively harmful. They trust it confidently.

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

**Capabilities:**

- New services or integrations added
- New functionality available to the project (e.g., "email sending via Resend")

### 3. Audit Existing AGENTS.md

Walk each documented AGENTS.md and verify against the actual codebase.

#### Check for staleness

**Code maps:**

- Do referenced files still exist at those paths?
- Do referenced symbols (functions, classes, types) still exist?
- Are new important symbols missing from the map?

**WHERE TO LOOK tables:**

- Do the referenced locations still match?
- Are there new common tasks not covered?

**Capabilities:**

- Does the project have services/integrations not listed?
- Would an agent asked to "add email sending" or "upload a file" know the project already supports it?

**Patterns & conventions:**

- Do documented patterns still match how the code actually works?
- Are there anti-patterns listed that are no longer relevant?
- Have conventions changed without the docs being updated?

**Subdirectory coverage:**

- Are there directories with significant complexity that lack AGENTS.md?
- Only flag directories that would genuinely confuse a future session — not every directory needs documentation.

#### Check for bloat (progressive disclosure)

**Duplication:**

- Is root AGENTS.md inlining content that already exists in pattern files or subdirectory docs?
- Are code examples duplicated between root and detail files?
- If content exists elsewhere, root should reference it, not copy it.

**Structure trees:**

- Does root have a detailed directory tree? Consider removing — agents discover structure via filesystem. WHERE TO LOOK tables serve the same purpose better.
- If a structure tree exists, is it stale? (This is the most common staleness source.)

**Line numbers:**

- Line numbers in code maps go stale fast. Prefer file paths without line numbers.

**Inlined conventions:**

- Are code style rules, service patterns, or code examples inlined in root?
- These belong in dedicated pattern files, referenced from root.

**Instruction count:**

- Rough-count the instructions in root AGENTS.md. If >150, it needs trimming.
- Every line should earn its place: "Would removing this cause the agent to make mistakes?"

### 4. Update AGENTS.md Files

Apply both captured learnings and audit fixes:

**When updating existing files:**

- Preserve existing structure and style
- Make surgical edits — don't rewrite entire sections
- Update stale entries inline (fix paths, rename symbols, correct patterns)
- Add new entries where they fit (new rows in tables, new items in lists)
- Remove entries only when the referenced code is clearly gone
- Move inlined content to detail files if it duplicates what exists elsewhere

**When trimming root AGENTS.md:**

- Verify displaced content exists in a detail file before removing from root
- Add a reference line in root pointing to the detail file
- Update SUBDIRECTORY DOCS / pointers

**When creating new AGENTS.md files:**

- Only for directories with genuine complexity (multiple files, non-obvious patterns)
- Keep them lean — 30-80 lines max
- Never repeat what the parent AGENTS.md already covers
- Follow the existing style in the project's other AGENTS.md files

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

### Progressive Disclosure

Root AGENTS.md is the most expensive file — it loads on every request. Structure content in tiers:

| Tier | Location                 | Loads when                        | Content                                                    |
| ---- | ------------------------ | --------------------------------- | ---------------------------------------------------------- |
| 1    | Root AGENTS.md           | Every request                     | Critical rules, capabilities, where to look, anti-patterns |
| 2    | Subdirectory AGENTS.md   | Agent reads files in that subtree | Domain-specific patterns, service architecture             |
| 3    | Pattern/convention files | Agent follows a reference link    | Detailed examples, code templates, full explanations       |

Move content to the lowest tier where it's still discoverable.

### Capabilities, Not Structure

Describe what the project **can do**, not how it's organized:

- "File uploads via S3 signed URLs" > a directory tree showing `lib/services/s3/`
- "Email sending via Resend" > listing every file in `lib/services/email/`
- A CAPABILITIES table helps agents know what's available without reading every service

### Incremental, Not Generative

This skill **maintains** existing AGENTS.md files. It doesn't regenerate them from scratch. Think `git commit`, not `git init`. If the project needs a full AGENTS.md generation, that's a different task.

### Verify Before Removing

If something looks stale but you're not 100% sure (e.g., a symbol you can't find might be dynamically generated), leave it and add a `?` or note rather than deleting.

### Concise Updates

AGENTS.md files should be telegraphic. When adding learnings:

- Bullet points, not paragraphs
- Code examples only when the pattern isn't obvious
- One line per convention/anti-pattern
- Tables for structured data (code maps, capabilities, locations)

### Don't Over-Document

Not every session produces learnings worth persisting. Not every directory needs AGENTS.md. If there's nothing meaningful to capture or fix:

> Nothing to update from this session.

## Completion

After updating, report what changed:

> **Updated AGENTS.md:**
>
> - `AGENTS.md` — added CAPABILITIES table, removed inlined service pattern (exists in lib/services/AGENTS.md)
> - `lib/services/AGENTS.md` — added Encryption service to code map
> - `patterns/TYPESCRIPT_CONVENTIONS.md` — added file naming conventions (moved from root)
>
> **Captured:** new error handling pattern, S3 upload convention
> **Trimmed:** removed stale directory tree, moved inlined code examples to pattern files
