---
name: index-knowledge
description: Generate hierarchical AGENTS.md knowledge base for a codebase. Creates root + complexity-scored subdirectory documentation.
---

# index-knowledge

Generate hierarchical AGENTS.md files. Root + complexity-scored subdirectories.

## Usage

```
--create-new   # Read existing → remove all → regenerate from scratch
--max-depth=2  # Limit directory depth (default: 5)
```

Default: Update mode (modify existing + create new where warranted)

---

## Workflow (High-Level)

1. **Discovery + Analysis** (concurrent)
   - Launch `explore` subagents in parallel with self-contained prompts
   - Main session: bash structure + LSP codemap + read existing AGENTS.md
2. **Score & Decide** - Determine AGENTS.md locations from merged findings
3. **Generate** - Root first, then subdirs in parallel
4. **Review** - Deduplicate, trim, validate

<critical>
**Track ALL phases. Mark in_progress → completed in real-time.**

- Discovery: launch `explore` subagents, build LSP codemap, read existing guidance (high priority).
- Scoring: score directories, determine locations (high priority).
- Generate: create root and subdirectory AGENTS.md files (high priority).
- Review: deduplicate, validate, trim (medium priority).
</critical>

---

## Phase 1: Discovery + Analysis (Concurrent)

**Mark "discovery" as in_progress.**

### Launch Parallel Explore Agents

Launch `explore` subagents in parallel with self-contained prompts. Each prompt includes the repository, scope, relevant guidance, and read-only reporting task; evidence must be inline or inside the child's repository checkout. Fresh children inherit no context. Assign these independent tracks:

- **Project structure:** predict standard patterns for detected language; report deviations only.
- **Entry points:** find main files; report non-standard organization.
- **Conventions:** find config files (.eslintrc, pyproject.toml, .editorconfig); report project-specific rules.
- **Anti-patterns:** find 'DO NOT', 'NEVER', 'ALWAYS', 'DEPRECATED' comments; list forbidden patterns.
- **Build/CI:** find .github/workflows, Makefile; report non-standard patterns.
- **Test patterns:** find test configs and test structure; report unique conventions.

<dynamic-agents>
**DYNAMIC AGENT LAUNCHES**: After bash analysis, launch ADDITIONAL `explore` subagents based on project scale:

| Factor | Threshold | Additional Agents |
|--------|-----------|-------------------|
| **Total files** | >100 | +1 per 100 files |
| **Total lines** | >10k | +1 per 10k lines |
| **Directory depth** | ≥4 | +2 for deep exploration |
| **Large files (>500 lines)** | >10 files | +1 for complexity hotspots |
| **Monorepo** | detected | +1 per package/workspace |
| **Multiple languages** | >1 | +1 per language |

```bash
# Measure project scale first
total_files=$(find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | wc -l)
total_lines=$(find . -type f \( -name "*.ts" -o -name "*.py" -o -name "*.go" \) -not -path '*/node_modules/*' -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
large_files=$(find . -type f \( -name "*.ts" -o -name "*.py" \) -not -path '*/node_modules/*' -exec wc -l {} + 2>/dev/null | awk '$1 > 500 {count++} END {print count+0}')
max_depth=$(find . -type d -not -path '*/node_modules/*' -not -path '*/.git/*' | awk -F/ '{print NF}' | sort -rn | head -1)
```

Example: 500 files, 50k lines, depth 6, 15 large files → launch additional `explore` subagents in parallel with self-contained prompts:

- **Large files:** find files >500 lines; report complexity hotspots.
- **Deep modules:** find hidden patterns and internal conventions at depth 4+.
- **Cross-cutting:** find shared utilities across directories.
- Add further tracks based on the calculation.
</dynamic-agents>

### Main Session: Concurrent Analysis

**While subagents execute**, main session does:

#### 1. Bash Structural Analysis
```bash
# Directory depth + file counts
find . -type d -not -path '*/\.*' -not -path '*/node_modules/*' -not -path '*/venv/*' -not -path '*/dist/*' -not -path '*/build/*' | awk -F/ '{print NF-1}' | sort -n | uniq -c

# Files per directory (top 30)
find . -type f -not -path '*/\.*' -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -30

# Code concentration by extension
find . -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.go" -o -name "*.rs" \) -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -20

# Existing AGENTS.md / CLAUDE.md
find . -type f \( -name "AGENTS.md" -o -name "CLAUDE.md" \) -not -path '*/node_modules/*' 2>/dev/null
```

#### 2. Read Existing AGENTS.md
```
For each existing file found:
  Read the file
  Extract: key insights, conventions, anti-patterns
  Store in EXISTING_AGENTS map
```

If `--create-new`: Read all existing first (preserve context) → then delete all → regenerate.

#### 3. LSP Codemap (if available)
Check the harness's LSP availability, then:
- Inspect document symbols for entry points (e.g. `src/index.ts`, `main.py`) in parallel.
- Search workspace symbols for classes, interfaces, and functions in parallel.
- Find references to top exports to measure centrality.

**LSP Fallback**: If unavailable, rely on `explore` subagents + AST-grep.

**Merge: bash + LSP + existing + subagent results. Mark "discovery" as completed.**

---

## Phase 2: Scoring & Location Decision

**Mark "scoring" as in_progress.**

### Scoring Matrix

| Factor | Weight | High Threshold | Source |
|--------|--------|----------------|--------|
| File count | 3x | >20 | bash |
| Subdir count | 2x | >5 | bash |
| Code ratio | 2x | >70% | bash |
| Unique patterns | 1x | Has own config | explore |
| Module boundary | 2x | Has index.ts/__init__.py | bash |
| Symbol density | 2x | >30 symbols | LSP |
| Export count | 2x | >10 exports | LSP |
| Reference centrality | 3x | >20 refs | LSP |

### Decision Rules

| Score | Action |
|-------|--------|
| **Root (.)** | ALWAYS create |
| **>15** | Create AGENTS.md |
| **8-15** | Create if distinct domain |
| **<8** | Skip (parent covers) |

### Output
```
AGENTS_LOCATIONS = [
  { path: ".", type: "root" },
  { path: "src/hooks", score: 18, reason: "high complexity" },
  { path: "src/api", score: 12, reason: "distinct domain" }
]
```

**Mark "scoring" as completed.**

---

## Phase 3: Generate AGENTS.md

**Mark "generate" as in_progress.**

### Root AGENTS.md (Full Treatment)

```markdown
# PROJECT KNOWLEDGE BASE

**Generated:** {TIMESTAMP}
**Commit:** {SHORT_SHA}
**Branch:** {BRANCH}

## OVERVIEW
{1-2 sentences: what + core stack}

## STRUCTURE
\`\`\`
{root}/
├── {dir}/    # {non-obvious purpose only}
└── {entry}
\`\`\`

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|

## CODE MAP
{From LSP - skip if unavailable or project <10 files}

| Symbol | Type | Location | Refs | Role |

## CONVENTIONS
{ONLY deviations from standard}

## ANTI-PATTERNS (THIS PROJECT)
{Explicitly forbidden here}

## UNIQUE STYLES
{Project-specific}

## COMMANDS
\`\`\`bash
{dev/test/build}
\`\`\`

## NOTES
{Gotchas}
```

**Quality gates**: 50-150 lines, no generic advice, no obvious info.

### Subdirectory AGENTS.md (Parallel)

Launch `general` subagents in parallel, one per non-root `AGENTS_LOCATIONS` entry. Give each a self-contained prompt with its assigned location, reason, discovery findings, applicable guidance, and parent content inline or inside its repository checkout. For example, `src/hooks` has high complexity; `src/api` is a distinct domain.

Each task must specify:
- 30–80 lines max.
- NEVER repeat parent content.
- Sections: OVERVIEW (1 line), STRUCTURE (if >5 subdirs), WHERE TO LOOK, CONVENTIONS (if different), ANTI-PATTERNS.
- Write directly to only the assigned path, e.g. `src/hooks/AGENTS.md`.

**Results return directly. Mark "generate" as completed.**

---

## Phase 4: Review & Deduplicate

**Mark "review" as in_progress.**

For each generated file:
- Remove generic advice
- Remove parent duplicates
- Trim to size limits
- Verify telegraphic style

**Mark "review" as completed.**

---

## Final Report

```
=== index-knowledge Complete ===

Mode: {update | create-new}

Files:
  ✓ ./AGENTS.md (root, {N} lines)
  ✓ ./src/hooks/AGENTS.md ({N} lines)

Dirs Analyzed: {N}
AGENTS.md Created: {N}
AGENTS.md Updated: {N}

Hierarchy:
  ./AGENTS.md
  └── src/hooks/AGENTS.md
```

---

## Anti-Patterns

- **Static agent count**: MUST vary agents based on project size/depth
- **Sequential execution**: MUST launch independent subagents in parallel
- **Ignoring existing**: ALWAYS read existing first, even with --create-new
- **Over-documenting**: Not every dir needs AGENTS.md
- **Redundancy**: Child never repeats parent
- **Generic content**: Remove anything that applies to ALL projects
- **Verbose style**: Telegraphic or die
