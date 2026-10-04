---
name: install-skill
description: Install a skill from a GitHub URL or local path. Copies SKILL.md (and references/scripts) into the project's .agents/skills/ directory and adds slash-command metadata. Use when user wants to add an existing skill to their project.
---

# Install Skill

Install an existing skill into `.agents/skills/<name>/SKILL.md` from a GitHub repo or local path. Both Pi and OpenCode read this source natively; no companion command file.

## Workflow

### Step 1: Identify the Source

The user provides one of:

- **GitHub URL** — e.g., `https://github.com/user/repo/tree/main/path/to/skill`
- **Local path** — e.g., `~/other-project/.agents/skills/my-skill/`
- **Global skill name** — a skill from `~/.agents/skills/` to copy into the project

If unclear, ask the user where the skill lives.

### Step 2: Fetch Skill Files

**From GitHub:**

```bash
# Clone the repo (shallow) to a temp directory, copy the skill files
TMPDIR=$(mktemp -d)
gh repo clone <user/repo> "$TMPDIR" -- --depth 1
cp -r "$TMPDIR/<path-to-skill-dir>" .agents/skills/<name>/
rm -rf "$TMPDIR"
```

**From local path:**

```bash
cp -r <source-path>/ .agents/skills/<name>/
```

**From global skills:**

```bash
cp -r ~/.agents/skills/<name>/ .agents/skills/<name>/
```

### Step 3: Verify Skill Structure

Check the copied skill has valid structure:

1. `SKILL.md` exists with valid YAML frontmatter (`name` + `description`)
2. `name` field matches directory name
3. Any `references/` or `scripts/` are present

If frontmatter is missing or invalid, fix it before proceeding.

### Step 4: Add Slash-Command Metadata

Ensure `SKILL.md` frontmatter includes this metadata, preserving any existing metadata keys:

```yaml
metadata:
  opencode/slash: "true"
```

OpenCode registers `/<name>` from this metadata. Pi already offers `/skill:<name>`.
Do not copy or create a companion command file.

### Step 5: Commit

```bash
git add .agents/skills/<name>/
git commit -m "add <name> skill"
```

### Step 6: Confirm

Verify the harness discovers the skill after reloading or restarting and that the slash-command metadata is present. Tell the user:

- Which skill was installed
- The slash command: OpenCode `/<name>`, Pi `/skill:<name>`
- File locations

## Important Notes

- **Skills are project-scoped** — installed in `.agents/skills/` and committed to git
- **Native discovery** — both harnesses read `.agents/skills/`; OpenCode slash commands use frontmatter metadata
- **To uninstall**: delete the skill directory, commit
