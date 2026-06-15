---
name: install-skill
description: Install a skill from a GitHub URL or local path. Copies SKILL.md (and references/scripts) into the project's .opencode/skills/ directory and creates the companion command. Use when user wants to add an existing skill to their project.
---

# Install Skill

Install an existing skill into the current project from a GitHub repo or local path.

## Workflow

### Step 1: Identify the Source

The user provides one of:

- **GitHub URL** — e.g., `https://github.com/user/repo/tree/main/path/to/skill`
- **Local path** — e.g., `~/other-project/.opencode/skills/my-skill/`
- **Global skill name** — a skill from `~/.config/opencode/skills/` to copy into the project

If unclear, ask the user where the skill lives.

### Step 2: Fetch Skill Files

**From GitHub:**

```bash
# Clone the repo (shallow) to a temp directory, copy the skill files
TMPDIR=$(mktemp -d)
gh repo clone <user/repo> "$TMPDIR" -- --depth 1
cp -r "$TMPDIR/<path-to-skill-dir>" .opencode/skills/<name>/
rm -rf "$TMPDIR"
```

**From local path:**

```bash
cp -r <source-path>/ .opencode/skills/<name>/
```

**From global skills:**

```bash
cp -r ~/.config/opencode/skills/<name>/ .opencode/skills/<name>/
```

### Step 3: Verify Skill Structure

Check the copied skill has valid structure:

1. `SKILL.md` exists with valid YAML frontmatter (`name` + `description`)
2. `name` field matches directory name
3. Any `references/` or `scripts/` are present

If frontmatter is missing or invalid, fix it before proceeding.

### Step 4: Create the Slash Command

If a companion command file wasn't included in the source, create `.opencode/commands/<name>.md`:

```markdown
---
description: <from skill's description field>
---

<One-line summary.>

First, invoke the skill tool to load the <name> skill:

` ` `skill({ name: '<name>' })` ` `

Then follow the skill instructions.

<user-request>
$ARGUMENTS
</user-request>
```

### Step 5: Commit

```bash
git add .opencode/skills/<name>/ .opencode/commands/<name>.md
git commit -m "add <name> skill"
```

### Step 6: Confirm

Tell the user:

- Which skill was installed
- The slash command: `/<name>`
- File locations

## Important Notes

- **Skills are project-scoped** — installed in `.opencode/` and committed to git
- **No registration needed** — opencode discovers skills automatically
- **To uninstall**: delete the skill directory and command file, commit
