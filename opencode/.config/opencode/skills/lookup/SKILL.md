---
name: lookup
description: Research a person or organization before any contact — cold email, demo, investor meeting, partnership call. Use when the user provides a name, org, or URL and wants to know who they're talking to.
---

# Lookup Skill

Research a person or organization to prepare for meetings, demos, or outreach. Produces a concise intelligence brief with everything relevant for the conversation.

## Business Context

**Read `AGENTS.md` first.** Follow the Knowledge Base index to read all referenced files. Understand:

- What the business does
- Who they serve
- Competitive landscape
- How they communicate
- Current priorities and stage

Use this context to:

- Frame the brief around what matters for YOUR business
- Identify relevant pain points and angles
- Match terminology and positioning
- Connect findings to your stated goals

If `AGENTS.md` doesn't exist, ask the user for basic context about their business before proceeding. The brief is only useful if framed around the user's situation.

## Input

The user provides a lead — could be:

- A person's name (+ optional role/org)
- An organization name
- A LinkedIn URL
- An email address
- A website URL
- A mix of the above

Ask clarifying questions ONLY if you genuinely can't determine who/what to research. Don't ask for info you can find yourself.

## Workflow

### Step 1: Identify the Lead

Determine:

- **Who** — person name, role, organization
- **What type** — potential customer, investor, partner, other
- **Meeting context** — cold outreach, scheduled demo, follow-up, investor pitch?

If the user didn't specify meeting context, infer from the lead type or ask briefly.

### Step 2: Research

Use `WebFetch` to gather intelligence from public sources. Search systematically:

**For organizations:**

1. Organization website — about page, values, focus areas
2. Search `"<org name>"` + relevant industry terms
3. Look for: size (employees, revenue signals), industry focus, tech stack, recent news, geographic presence
4. Check for regulatory context relevant to your product/service
5. Look for budget signals — funding rounds, job posts, expansion announcements

**For people:**

1. Search `"<name>" "<org>"` to find LinkedIn, articles, interviews
2. Look for: role, background, interests, public statements
3. Check if they've spoken at conferences, written articles, or been quoted in media
4. Look for shared connections or common ground

**For investors:**

1. Search for portfolio, investment thesis, focus areas
2. Look for: relevant investments, stage preference, check size
3. Find interviews, blog posts, public statements about what they look for
4. Check Crunchbase or similar for portfolio data

**For partners:**

1. Understand their business model and customer base
2. Look for: overlap with your audience, complementary offerings
3. Check for existing partnerships or integrations they've done
4. Assess mutual value potential

### Step 3: Analyze Relevance

Connect the research to YOUR business's value proposition. Think about:

- **Pain points this lead likely has** — based on their size, type, industry, profile
- **Regulatory/compliance hooks** — any obligations or requirements your product addresses
- **Product fit** — does their situation match what you offer?
- **Decision-making** — who decides? What's their likely process and timeline?
- **Objections to anticipate** — budget concerns, existing solutions, skepticism
- **Conversation openers** — what can you reference to build rapport?

### Step 4: Write the Brief

Output a structured brief. Default location: `lookup/<name-or-org-slug>.md`. If the project already has a different convention for storing this kind of document, follow that instead.

Use this format:

```markdown
# <Lead Name / Organization>

**Type:** <Customer / Investor / Partner / Other>
**Date researched:** <today>
**Meeting context:** <Cold outreach / Demo / Follow-up / Pitch>

## Quick Summary

<2-3 sentences: who they are, why they matter, key angle for the conversation>

## Organization

- **Name:**
- **Type:** <Industry/category>
- **Location:**
- **Size:** <employees, revenue signals, funding if known>
- **Focus:** <what they do, their specialization>
- **Website:**

## Key People

| Name | Role | Notes |
|------|------|-------|
| | | |

## Relevance to Us

### Why They Need Us
<Bullet points connecting their situation to your value proposition>

### Product/Service Fit
<How their needs align with what you offer>

### Regulatory/Compliance Angle
<Any obligations or requirements your product addresses — or "None identified">

## Conversation Strategy

### Opening
<What to reference to build rapport — something specific to them>

### Key Points to Emphasize
<Top 3 selling points for THIS specific lead>

### Potential Objections
<What they might push back on + suggested responses>

### Ask
<What's the goal of this interaction? Demo booking? Follow-up? Decision?>

## Raw Notes

<Any other interesting findings, links, quotes>
```

Adapt the format to the lead type:

- **Investors:** replace "Why They Need Us" with "Investment Thesis Fit", add "Portfolio Overlap" section
- **Partners:** focus on mutual value, collaboration angles
- **Large organizations:** emphasize scale, procurement process, stakeholder landscape

### Step 5: Key Takeaways

End with a verbal summary — 3-4 sentences, conversational, highlighting the most important thing to know going into the conversation.

## Important Notes

- **Be honest about gaps.** If you couldn't find much, say so. Don't fabricate.
- **Prioritize actionable intel.** Skip generic info. Focus on what changes how you approach the conversation.
- **Local context matters.** Understand the lead's market, regulatory environment, and business culture.
- **Time is money.** Be thorough but fast. The brief should take minutes to read.
- **Update if revisited.** If the user asks to research the same lead again, update the existing file.

## Version Control

**Save work automatically.** Users don't know git — treat commits as auto-save checkpoints.

**When users say "save"** — commit and push immediately. They expect their files to be saved.

```bash
git add -A
git commit -m "lookup: <name or org>"
git push
```

Do this silently. Don't ask permission or announce commits.

## Completion

After delivering the brief, give the verbal summary and ask:

> Want me to dig deeper into any area, research additional people at this org, or adjust the angle?

Iterate until the user is satisfied.
