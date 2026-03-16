---
name: research
description: Conduct deep research on any topic with sources, analysis, and actionable insights.
---

# Research Skill

Conduct thorough research producing actionable insights. Output format depends on the user's needs.

## Business Context

**Read `AGENTS.md` first.** Follow the Knowledge Base index to read relevant files and understand:

- What the business does
- Who they serve
- Their competitive landscape
- How they communicate
- Current priorities

Use this context to:

- Frame research in terms relevant to their business
- Prioritize findings that matter to their situation
- Match their terminology and communication style
- Connect insights to their stated goals

If `AGENTS.md` doesn't exist, proceed without it. Don't ask users to run /onboard first.

## Workflow

1. **Read context** - Read `AGENTS.md` and follow pointers for business understanding
2. **Understand the request** - What does the user need to know? Why?
3. **Clarify scope** (2-3 questions max) - Focus the research appropriately
4. **Research** - Use web search, fetch URLs, analyze information
5. **Synthesize** - Identify patterns, insights, implications
6. **Deliver** - Present findings in whatever format serves the user best
7. **Iterate** - Refine until user is satisfied

## Clarifying Questions

Keep to 2-3 questions. Focus on:

- **Purpose** - What decision or action will this inform?
- **Scope** - Any specific focus, constraints, or boundaries?
- **Depth** - Quick overview or comprehensive deep-dive?
- **Output** - How should findings be delivered? (summary, report, data, files)

## Research Approach

### Source Quality

1. **Primary sources first** - Official data, filings, academic papers
2. **Authoritative secondary** - Industry reports, reputable journalism
3. **Supporting context** - Blogs, forums, social (for sentiment/trends)

### Methodology

- Cross-reference claims across sources
- Note where sources conflict
- Prefer recent data, flag when dated
- Clearly mark low-confidence findings

## Output Flexibility

**No fixed format.** Deliver what the user needs:

- Single summary for quick decisions
- Detailed report with sections for thorough analysis
- Multiple files for complex topics (e.g., by region, by competitor)
- Data tables for quantitative research
- Bullet points for scanning
- Narrative for storytelling

**Always include:**

- Key findings (what we learned)
- Implications (why it matters)
- Sources (where it came from)

**When uncertain about format, ask.**

## Key Principles

### Answer "So What?"

Don't just report facts. Explain:

- What does this mean for the user?
- What should they do about it?
- What are the implications?

### Be Honest About Confidence

- Distinguish fact from interpretation
- Flag conflicting sources
- Note gaps and limitations
- Don't overstate certainty

### Source Everything

- Every claim needs attribution
- Note source recency and reliability
- Prefer primary over secondary

### Stay Focused

- Answer the user's actual question
- Don't pad with tangential information
- Depth where it matters, brevity elsewhere

## Version Control

**Save work automatically.** Users don't know git - treat commits as auto-save checkpoints.

**When users say "save"** - commit and push immediately. They expect their files to be saved.

Commit and push when meaningful progress is made:

- Finished a section or finding
- Added significant new content
- Completed a revision the user requested
- Reached a natural stopping point

**Don't commit on every tiny edit** - use judgment for logical checkpoints.

```bash
git add -A
git commit -m "research: <brief description>"
git push
```

Do this silently. Don't ask permission or announce commits.

## Completion

Research is complete when the user confirms satisfaction.

After delivering findings, ask:

> Does this address what you were looking for?
> Want me to dig deeper into any area, add sources, or adjust the format?

Iterate until done.
