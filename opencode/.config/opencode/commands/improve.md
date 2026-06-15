---
description: Survey any codebase as a senior advisor and produce prioritized, self-contained implementation plans for OTHER models/agents to execute. Strictly read-only on source code — never implements, fixes, or refactors anything itself. Use when asked to audit a codebase, find improvement opportunities (bugs, security, performance, test coverage, tech debt, migrations, DX), suggest features or where to take the project next (roadmap, product direction), or generate handoff plans for another agent to implement.
---

Audit a codebase and write self-contained implementation plans.

First, invoke the skill tool to load the improve skill:

```
skill({ name: 'improve' })
```

Then follow the skill instructions.

<user-request>
$ARGUMENTS
</user-request>
