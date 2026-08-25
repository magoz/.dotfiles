---
name: conform
description: Audit and surgically fix implementation code against the current repository's documented standards, patterns, boundaries, and verification tooling. Use when code should be aligned with AGENTS.md, pattern guides, contributing rules, or established repository conventions.
metadata:
  opencode/slash: 'true'
---

# Conform

Make implementation code conform to the current repository's own rules.

This skill changes code unless `--check` is passed. For documentation-system maintenance, use
`tidy`. For capturing durable knowledge from the current session, use `learn`.

## Authority

Repository policy comes from the repository, not this skill. Never import framework, architecture,
style, or testing rules from another project.

Use this precedence when sources disagree:

1. User instructions for the current task
2. Root and applicable nested `AGENTS.md`
3. Normative guides explicitly linked by those files
4. Repository-owned tool configuration and verification scripts
5. Clear local precedent in adjacent implementation and tests

Treat inferred precedent as a judgment call, not a documented violation. A repository rule overrides
generic preferences.

## Arguments

| Argument    | Meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| `--check`   | Audit and report only; do not edit                                            |
| `--changed` | Scope to working-tree changes and commits since the default-branch merge-base |
| `--all`     | Broad repository audit; expensive and never the implicit scope                |
| `[path...]` | Scope to the named files or directories                                       |

Default scope, in order: paths named by the user, files involved in the current task, then current
working-tree changes. For `--changed`, resolve the repository's default branch and use its merge-base
with `HEAD`; include working-tree changes. If the base cannot be resolved, use working-tree changes
only and report the limitation. If the repository is clean and no scope is identifiable, ask rather
than silently auditing the entire repository.

## Workflow

### 1. Establish scope and safety

- Resolve the repository root.
- Inspect version-control status before editing.
- Preserve unrelated user changes; do not reset, overwrite, stage, or reformat them.
- For a non-trivial run, maintain a concise checklist using the harness's planning facility when one
  is available.

### 2. Discover applicable guidance

Read only the documentation map needed for the target:

1. Root `AGENTS.md` and any repository-declared equivalent, when present
2. Every ancestor or nearest nested guidance file governing target files
3. Pattern, convention, architecture, testing, or contribution guides linked from that guidance
4. Relevant tool configuration, manifests, and CI scripts

When root guidance does not provide an index, check conventional entry points such as
`patterns/README.md`, `docs/patterns/README.md`, `CONTRIBUTING.md`, and architecture/spec indexes.
Treat a document as normative only when its role, wording, or repository guidance makes that clear;
do not treat every Markdown file as a coding standard.

Use harness-native file discovery, content search, and reading tools. Prefer structured tools over
recursive shell `find`/`grep` when available.

### 3. Build the audit checklist

Translate applicable guidance into a compact rule matrix:

| Rule | Source | Target files | Evidence |
| ---- | ------ | ------------ | -------- |

Check only rules relevant to the scoped files. Typical categories include:

- architectural and dependency boundaries
- boundary parsing, authorization, error handling, and observability
- naming, imports, types, and file placement
- mutation and data-access conventions
- test shape and destructive-test safety
- generated-file and secret handling
- required verification commands

Distinguish:

- **Documented violation** — cite the owning file and rule
- **Tool-enforced failure** — cite the command/configuration
- **Local inconsistency** — cite the adjacent exemplar and label it inferred

If the user supplied a feature specification, also check functional compliance. Otherwise, do not
invent product requirements from plans or unrelated design documents.

### 4. Audit, then patch

- Search for concrete violations before editing.
- In `--check` mode, report exact files, evidence, and proposed fixes; make no changes.
- Otherwise patch the smallest safe slice.
- Preserve behavior unless the documented rule requires a behavioral correction.
- Follow the repository's type-safety and formatting rules; never weaken types merely to satisfy a
  check.
- Avoid broad rewrites, unrelated cleanup, dependency changes, and formatting churn.

When guidance is absent or weak, stay conservative: rely on explicit configuration, compiler/linter
output, tests, and well-established adjacent code. Report that project-specific conformance could not
be fully established instead of fabricating rules.

### 5. Verify

Infer commands from repository guidance first, then manifests, task runners, and CI configuration.
Do not assume a package manager or fixed script names.

Run checks in increasing scope and cost:

1. Targeted tests or static checks for changed files
2. Changed-file formatting in write mode, when the repo provides it
3. Relevant typecheck/lint/test commands
4. Build or end-to-end checks only when warranted and practical

Never run destructive, production, publish, or migration commands without explicit user approval.
For credentialed or external-network commands, require documented safety and clear user intent. If
unrelated pre-existing failures block a broad check, report the exact blocker and retain narrower
evidence.

### 6. Report

Summarize:

- scope and guidance sources used
- rules enforced and whether documented, tool-enforced, or inferred
- files changed, grouped by area
- commands run and results
- remaining gaps, uncertainty, and unrelated blockers

Do not commit or push unless explicitly requested.

## Anti-patterns

- Hardcoding one repository's stack or folder layout into this global skill
- Treating every nearby style choice as a mandatory rule
- Auditing the whole repository by default
- Fixing documentation instead of implementation; use `tidy`
- Hiding failures or weakening types to make checks pass
- Touching unrelated work or committing without explicit permission
