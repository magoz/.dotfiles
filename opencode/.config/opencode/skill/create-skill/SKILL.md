---
name: create-skill
description: Create a custom skill for this project. Determines skill type, writes SKILL.md (and optional references/scripts) to .opencode/skill/<name>/, commits and pushes. Load FIRST before writing any skill.
---

# Create Skill

Create custom skills that extend what agents can do in this project. Each skill is a `SKILL.md` with instructions + a companion slash command so users can invoke it via `/<name>`.

## Skill Type Decision Tree

```
What are you building?
├─ Instructions only → Minimal skill (SKILL.md only)
│   Example: code review guidelines, commit message format
│
├─ Domain knowledge → Reference skill (+ references/)
│   Example: API docs, database schemas, internal conventions
│
├─ Repeatable automation → Script skill (+ scripts/)
│   Example: data validation, file conversion, test runners
│
├─ Complex multi-step workflow → Multi-file skill (all directories)
│   Example: release process, deployment pipeline
│
└─ Large platform/domain → Progressive skill (decision tree + references/)
    Example: large API surface, many sub-products
```

## Directory Patterns

### Minimal (SKILL.md only)

```
my-skill/
└── SKILL.md          # < 200 lines
```

When: instructions fit in one file, no external resources.

### With References

```
my-skill/
├── SKILL.md          # Overview + navigation table
└── references/
    ├── api.md        # Detailed API docs
    └── patterns.md   # Best practices
```

When: content > 200 lines, different tasks need different sections.

### With Scripts

```
my-skill/
├── SKILL.md
└── scripts/
    └── validate.sh   # Executable automation
```

When: repeatable operations, deterministic validation/conversion.

### Multi-File

```
my-skill/
├── SKILL.md          # Hub: overview + decision tree + navigation
├── references/
│   ├── workflow.md
│   └── troubleshooting.md
├── scripts/
│   └── deploy.sh
└── assets/
    └── template.yaml # Templates/boilerplate for output
```

When: complex workflows mixing docs + automation + templates.

## File Size Guidelines

| File Type      | Target        | Max       |
| -------------- | ------------- | --------- |
| SKILL.md       | 150-200 lines | 500 lines |
| Reference file | 100-150 lines | 200 lines |

Large files cause context rot — agent performance degrades. Split content into references/ when SKILL.md exceeds ~200 lines.

## Workflow

### Step 1: Discovery — Ask Questions

**Always ask the user questions before writing anything.** Even if `$ARGUMENTS` provides a clear idea, dig deeper to understand the full picture. Ask about:

- **Goal:** What problem does this skill solve? What's the end result?
- **Trigger:** When should the agent use this skill? What situation or user request activates it?
- **Steps:** What does the skill do, step by step? What commands, tools, or files are involved?
- **Context:** Are there project-specific patterns, MCP tools, or conventions it should follow?
- **Scope:** Is this a simple set of instructions, or does it need reference docs / scripts?

Don't ask all of these if some are already clear from context — but always ask enough to understand the **why**, not just the **what**.

### Step 2: Confirm the Plan

After gathering answers, present a summary for user approval **before writing any files**:

```
Proposed skill:
  Name: <name>
  Description: <description>
  Type: <minimal | reference | script | multi-file>
  Files:
    - .opencode/skill/<name>/SKILL.md
    - .opencode/command/<name>.md
    [- .opencode/skill/<name>/references/... ]
    [- .opencode/skill/<name>/scripts/... ]
```

Wait for the user to confirm or adjust before proceeding.

**Choosing name and description:**

**Name:** Short, descriptive kebab-case. Must match: `^[a-z0-9]+(-[a-z0-9]+)*$`

- 1-64 chars, lowercase alphanumeric, hyphens only
- No leading/trailing hyphens, no consecutive hyphens
- Directory name must match the `name` field

Good: `deploy-preview`, `test-e2e`, `api-client`
Bad: `Deploy_Preview`, `--test`, `my skill`

**Description:** Answer **"When should the agent use this skill?"** — this is what appears in the skill tool listing. Write in third person. Include what AND when.

Good:

- "Extract text and tables from PDF files. Use when working with PDFs or asked to read/edit them."
- "Run and fix test failures. Use when tests fail or user asks to fix the test suite."

Bad:

- "A skill for tests" (too vague — agent won't know when to trigger)
- "I help with PDFs" (wrong POV, no trigger context)

### Step 3: Write the Skill Files

Create at `.opencode/skill/<name>/SKILL.md`. For multi-file skills, create subdirectories as needed.

**Frontmatter (required, must start at line 1, no blank lines before `---`):**

```yaml
---
name: skill-name
description: What it does and when to use it.
---
```

| Field         | Required | Constraints                                                    |
| ------------- | -------- | -------------------------------------------------------------- |
| `name`        | Yes      | 1-64 chars, matches directory name, `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `description` | Yes      | 1-1024 chars, third person, includes when to use               |

**Both fields are required.** Skills with missing or invalid frontmatter are silently ignored.

**Writing effective instructions:**

1. **Start with context** — what the skill does and when it applies
2. **Step-by-step workflow** — numbered steps the agent should follow
3. **Be specific** — reference actual commands, file paths, patterns from the project
4. **Include examples** — expected inputs/outputs, command invocations
5. **Handle errors** — what to do when things go wrong
6. **Keep it focused** — one skill, one job

**For multi-file skills, add a navigation table in SKILL.md:**

```markdown
## In This Skill

| File                                               | Purpose           |
| -------------------------------------------------- | ----------------- |
| [references/api.md](./references/api.md)           | API reference     |
| [references/patterns.md](./references/patterns.md) | Best practices    |
| [scripts/validate.sh](./scripts/validate.sh)       | Validation script |

## Reading Order

| Task              | Files                           |
| ----------------- | ------------------------------- |
| Quick start       | SKILL.md only                   |
| Implement feature | SKILL.md → api.md → patterns.md |
| Debug issue       | SKILL.md → gotchas.md           |
```

This lets the agent load only what's needed for the task, keeping token usage low.

**Minimal skill template:**

```markdown
---
name: <name>
description: <what + when>
---

# <Title>

<Brief overview.>

## Workflow

### Step 1: <First Step>

<Instructions...>

### Step 2: <Second Step>

<Instructions...>

## Important Notes

- <Gotchas, edge cases>
```

**Reference skill template:**

```markdown
---
name: <name>
description: <what + when>
---

# <Title>

<Brief overview.>

## In This Skill

| File                                     | Purpose       |
| ---------------------------------------- | ------------- |
| [references/api.md](./references/api.md) | API reference |

## Quick Start

<Core instructions here, keep under 200 lines.>

## Important Notes

- <Gotchas, edge cases>
```

### Step 4: Create the Slash Command

Every skill needs a companion slash command so users can invoke it via `/<name>`. Create `.opencode/command/<name>.md`:

```markdown
---
description: <short description of what the command does>
---

<One-line summary of what this does.>

First, invoke the skill tool to load the <name> skill:

` ` `skill({ name: '<name>' })` ` `

Then follow the skill instructions.

<user-request>
$ARGUMENTS
</user-request>
```

This pattern:

- `/` prefix makes it a slash command (e.g., `/deploy-preview`)
- Loads the full skill instructions on demand (not at startup)
- `$ARGUMENTS` passes whatever the user typed after the command name

### Step 5: Commit and Push

```bash
git add .opencode/skill/<name>/ .opencode/command/<name>.md
git commit -m "add <name> skill"
git push
```

### Step 6: Verify

Both the skill and command are available after restarting opencode. Tell the user:

- Skill name and location
- Slash command: `/<name>` (or `/<name> <args>`)
- Committed to git

## Common Mistakes

| Mistake                         | Fix                                            |
| ------------------------------- | ---------------------------------------------- |
| No slash command created        | Create `.opencode/command/<name>.md` alongside |
| Blank lines before `---`        | Frontmatter must start at line 1               |
| Missing closing `---`           | Add `---` after frontmatter fields             |
| Name doesn't match directory    | Make `name:` field = directory name            |
| SKILL.md > 500 lines            | Split into references/                         |
| Vague description               | Include what + when, write in third person     |
| Generic instructions            | Reference specific commands, paths, patterns   |
| Duplicated content across files | Link to references, don't copy                 |

## Tips

- **Reference project context**: mention specific directories, config files, conventions
- **Use the project's tools**: if MCP servers exist, reference their tools by name
- **Chain skills**: a skill can instruct the agent to load another skill for sub-tasks
- **Keep it actionable**: every sentence should help the agent do something concrete
- **Avoid generic advice**: "write clean code" is useless; "run `pnpm lint` and fix errors" is useful
- **Scripts need shebangs**: `#!/usr/bin/env bash` + `set -euo pipefail`

## Important Notes

- **Always create both files** — `.opencode/skill/<name>/SKILL.md` + `.opencode/command/<name>.md`
- **File must be named `SKILL.md`** (uppercase) — opencode ignores other names
- **Directory name must match** the `name` field in frontmatter
- **Skills are project-scoped** — stored in `.opencode/` and committed to git
- **No registration needed** — opencode discovers skills and commands automatically
- **Both `skill/` and `skills/` work** — opencode scans both, prefer `skill/` for consistency
