---
name: tidy
description: Maintain a repository's AGENTS.md hierarchy, pattern and architecture guides, stale references, and project-local agent instructions. Use for documentation hygiene, progressive disclosure, misplaced guidance, or stale knowledge after code and tooling changes.
metadata:
  opencode/slash: 'true'
---

# Tidy

Keep the current repository's knowledge system accurate, concise, and owned by the right boundary.

Default mode is a surgical documentation update. Do not rebuild the hierarchy unless the user passes
`--create-new`. For implementation-code fixes, use `conform`. For session-derived learnings, use
`learn`.

## Arguments

| Argument        | Meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| `--check`       | Audit and report only; do not edit                                   |
| `--docs`        | Documentation-only mode; the default                                 |
| `--create-new`  | Rebuild or establish the hierarchy after reading existing docs first |
| `--max-depth=N` | Limit nested guidance discovery; default `5`                         |
| `[path...]`     | Focus on named documentation or repository areas                     |

Ask before destructive regeneration when `--create-new` was not explicitly supplied. In default
mode, if no repository knowledge hierarchy exists, report the gap rather than generating one.

## Knowledge model

Discover the repository's actual model; do not assume specific frameworks or directories.

Typical tiers are:

| Tier             | Owner                                                | Appropriate content                                                                |
| ---------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Root guidance    | `AGENTS.md` or repository equivalent                 | Critical global rules, capabilities, where to look, commands, global anti-patterns |
| Scoped guidance  | Nested `AGENTS.md`                                   | Rules and maps unique to that subtree                                              |
| Pattern guides   | Repository-linked `patterns/`, specs, or conventions | Detailed cross-cutting behavior and copyable examples                              |
| Decision records | ADR/decision system already used by the repo         | Decisions, alternatives, tradeoffs, consequences                                   |
| Tooling config   | Manifests, task runners, CI, linters                 | Executable truth for commands and enforced rules                                   |

Repository guidance decides which tiers are normative. Existing explicit size and placement rules win.
Without such rules, treat roughly 80–150 root lines and 30–80 child lines as review prompts, not hard
limits.

## Workflow

### 1. Establish scope and safety

- Resolve the repository root and inspect version-control status.
- Preserve unrelated user changes; do not reset, overwrite, stage, or reformat them.
- For non-trivial work, maintain a concise checklist using the harness's planning facility when one is
  available.

### 2. Discover documentation link-first

Start with:

1. Root `AGENTS.md` and any repository-declared equivalent
2. Pattern/specification/architecture indexes linked from root guidance
3. Relevant nested guidance files, following the repository hierarchy
4. Contribution, decision, and testing guides referenced by those sources

Only then use conventional fallbacks when needed:

- `**/AGENTS.md`
- `patterns/README.md`, `patterns/*.md`, or `docs/patterns/**`
- `CONTRIBUTING.md`, architecture indexes, ADR/decision directories, and normative specs
- project-local `.agents`, `.pi`, `.opencode`, or `.claude` skills/agents/commands when present

Do not ingest every Markdown file. Ignore dependencies, generated output, caches, coverage/reports,
vendored references, migrations snapshots, environment files, and secrets unless their owning docs
are directly in scope.

Use harness-native discovery, content search, and reading tools. Prefer structured tools over
recursive shell `find`/`grep` when available.

### 3. Classify problems by owner

Place knowledge at the narrowest level where it remains discoverable:

- critical repository-wide constraint or capability → root guidance
- subtree-specific map or rule → nearest scoped guidance
- detailed reusable implementation behavior → pattern/convention guide
- decision with alternatives and consequences → existing ADR/decision system
- executable command or enforced rule → tooling config as truth; docs summarize and link
- temporary plan, status, or one-off workaround → not permanent guidance

Root guidance should orient, not duplicate. Prefer concise “where to look” pointers over file trees,
large code maps, copied examples, or implementation detail. Child guidance should not repeat its
parent except for a genuinely critical local reminder.

Before deleting or heavily trimming unique material, create a preservation map:

| Removed topic | Destination or reason for deletion | Verified |
| ------------- | ---------------------------------- | -------- |

Verify destination content before removal. If ownership is unclear, report the ambiguity instead of
silently discarding knowledge.

### 4. Check accuracy and stale references

Validate claims against repository evidence:

- referenced paths and symbols still exist
- commands match manifests, task runners, and CI
- names, package managers, integrations, and environment-variable names are current
- moved or renamed docs have no stale links
- root and child guidance do not conflict or duplicate
- documented boundaries match imports and current code placement
- project-local skills and agents do not encode obsolete paths, commands, or hierarchy assumptions

Derive stale-reference candidates from current docs, version-control changes, recent moves, and the
repository's own vocabulary. Do not carry another project's stale-term checklist into this repo.

### 5. Edit surgically

In `--check` mode, list exact proposed changes and continue to an audit-only result.

Otherwise:

- preserve the repository's documentation style and terminology
- make the smallest coherent edits
- use telegraphic prose, tables for maps, and links instead of duplicated detail
- update all references when moving or renaming docs
- avoid compatibility pointer files unless requested
- create nested guidance only for genuinely complex or non-obvious boundaries
- never expose secrets or copy environment values into docs
- in default documentation mode, report executable config/script drift instead of changing it;
  executable edits require explicit user authorization

`--create-new` still requires reading and preserving useful existing knowledge before replacement.
Regeneration is not permission to discard unique rules.

### 6. Validate

For documentation-only runs:

- re-check changed links, paths, symbols, and commands
- search for stale references relevant to the edits
- inspect the final diff for accidental loss or duplication

Do not run a full build for prose-only changes. When executable scripts or configuration changed, run
the narrowest relevant check and expand only when warranted.

### 7. Report

Summarize:

- files created, moved, or updated
- misplaced knowledge and its new owner
- large trims and preservation destinations
- stale references checked
- validation performed and remaining uncertainty

Do not commit or push unless explicitly requested.

## Anti-patterns

- Assuming every repository uses the same application or library boundaries
- Rebuilding documentation by default
- Creating guidance in every directory
- Deleting dense material without verifying preservation
- Treating generated or secret files as documentation sources
- Duplicating detail across root, child, and pattern tiers
- Changing implementation code or executable configuration without explicit authorization
- Committing without explicit permission
