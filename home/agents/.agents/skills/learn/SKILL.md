---
name: learn
description: Capture durable repository knowledge from the current session and update the smallest appropriate AGENTS.md, pattern guide, or decision record after verifying it against the codebase. Use when conventions, architecture decisions, capabilities, or anti-patterns discovered during work should be preserved.
metadata:
  opencode/slash: 'true'
---

# Learn

Capture durable knowledge from the current session without turning one implementation into accidental
repository policy.

Default mode updates documentation. Pass `--check` to report proposed changes only. For a broad
knowledge-hierarchy audit, use `tidy`; for implementation compliance, use `conform`.

## Arguments

| Argument    | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `--check`   | Propose knowledge changes without editing                     |
| `--create`  | Allow creation of a missing root guidance file when warranted |
| `[path...]` | Focus capture and verification on the named repository area   |

`--check` always wins over `--create`: audit-only mode never creates or edits files. Without
`--create`, do not invent a new documentation hierarchy when the repository has no clear knowledge
owner. Report the proposed learning and where it could live instead.

## Durable-knowledge test

Persist a learning only when it is:

1. **Supported** — explicitly decided by the user or verified in current code/config/tests
2. **Durable** — likely to remain true beyond this branch or task
3. **Non-obvious** — useful to a future agent and not trivially discoverable
4. **Actionable** — changes where or how future work should be done
5. **Owned** — has a clear documentation destination

Do not persist:

- temporary debugging facts, branch status, or unfinished plans
- guesses, unresolved alternatives, or accidental implementation details
- generic language/framework advice that the repository does not specialize
- rules contradicted by current code unless recorded explicitly as desired migration intent
- secrets, credentials, personal data, or environment values
- a convention observed in only one new file without corroboration or an explicit decision

Not every session produces a learning worth storing.

## Workflow

### 1. Establish evidence and scope

- Resolve the repository root and inspect version-control status.
- Review the current conversation, decisions, and relevant changes.
- Default to the current task and touched area; do not audit every guidance file.
- Preserve unrelated user changes; do not reset, overwrite, stage, or reformat them.
- For non-trivial work, maintain a concise checklist using the harness's planning facility when one is
  available.

### 2. Discover the affected knowledge map

Read only what is needed to place and verify candidate learnings:

1. Root `AGENTS.md` and any repository-declared equivalent, when present
2. Applicable ancestor or nearest nested guidance for touched files
3. Pattern/specification/architecture indexes linked by those files
4. Existing pattern or decision documents that may already own the topic
5. Relevant source, tests, configuration, and commands that verify the claim

When root guidance provides no index, use conventional locations such as `patterns/README.md`,
`docs/patterns/README.md`, `CONTRIBUTING.md`, architecture indexes, and ADR/decision directories only
as needed. Do not read every Markdown file.

Use harness-native discovery, content search, and reading tools. Prefer structured tools over
recursive shell `find`/`grep` when available.

### 3. Extract candidate learnings

Look for:

- newly established naming, import, file-placement, boundary, or error-handling conventions
- architectural decisions and rejected alternatives with durable reasons
- approaches that failed and should become repository-specific anti-patterns
- new or changed capabilities, services, integrations, commands, or supported workflows
- non-obvious framework, runtime, deployment, or testing constraints verified during the work
- stale guidance directly exposed by the session's changes

For each candidate, record the claim, evidence, expected lifetime, and proposed owner. If evidence is
uncertain, verify it or omit the learning.

### 4. Choose the narrowest durable owner

| Learning                                          | Destination                                                |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Critical repository-wide constraint or capability | Root guidance                                              |
| Subtree-specific map, command, or rule            | Nearest scoped guidance                                    |
| Detailed reusable implementation behavior         | Existing or repository-standard pattern guide              |
| Decision with alternatives and consequences       | Existing ADR/decision system                               |
| Executable command or enforced rule               | Tool configuration is truth; guidance summarizes and links |
| Temporary or one-off detail                       | Do not persist                                             |

Follow the repository's existing hierarchy and terminology. Do not create a new pattern system or ADR
format merely because this skill recognizes those concepts.

If no root guidance exists:

- in `--check` mode, report the proposed owner and content
- without `--create`, do not create one
- with `--create`, create only the minimal root guidance needed for the verified learning; do not
  generate a full repository map

### 5. Verify before writing

- Confirm paths and symbols exist.
- Confirm commands against manifests, task runners, or CI.
- Check whether the learning is already documented elsewhere.
- Search for counterexamples that would make the statement too broad.
- Scope the wording to the evidence: use “in this area” instead of “always” when appropriate.
- When documentation and implementation differ, describe the discrepancy; do not automatically treat
  either side as correct without repository or user evidence.

### 6. Update surgically

In `--check` mode, report exact proposed files and text-level knowledge changes; make no edits.

Otherwise:

- preserve existing structure, voice, and terminology
- add or correct the smallest coherent entry
- prefer concise bullets, table rows, and links over paragraphs
- move detailed examples to the repository's established pattern tier
- avoid duplicating parent and child guidance
- remove stale entries only when the evidence is clear

If capture exposes broad duplication, hierarchy debt, or many unrelated stale references, stop at the
session-backed update and report that `tidy --check` is the appropriate follow-up.

### 7. Validate and report

Re-read changed documentation and verify its links, paths, symbols, and commands. Usually no build is
needed for documentation-only capture unless executable configuration also changed.

Report:

- files updated or proposed
- learning captured and its evidence
- stale guidance corrected, if directly relevant
- candidates rejected as temporary, obvious, uncertain, or already documented
- validation performed and any follow-up tidy work

If nothing passes the durable-knowledge test, say:

> Nothing durable to update from this session.

Do not commit or push unless explicitly requested.

## Anti-patterns

- Treating every implementation choice as a new convention
- Running a hierarchy-wide audit by default
- Creating root guidance without `--create`
- Recording unverified claims or unresolved decisions as fact
- Copying generic framework advice into repository guidance
- Duplicating knowledge across root, child, pattern, and decision tiers
- Automatically staging, committing, or pushing documentation changes
