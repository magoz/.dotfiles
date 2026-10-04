---
name: research
description: Investigate a question against high-trust primary sources and synthesize cited findings. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to background agents.
metadata:
  opencode/slash: "true"
---

Delegate reading legwork to `web-researcher` (web) and/or `explore` (code) subagents so research can proceed without consuming the parent session's context. Use the harness's subagent tool, not nested CLI processes or terminal panes. If subagents are unavailable, research directly in the current session.

## Delegation strategy

Choose the number of researchers based on the work rather than a fixed limit:

- Use one focused researcher for a narrow question.
- Launch researchers in parallel when the question has genuinely independent tracks, source domains, or competing claims worth checking separately.
- Give each child a self-contained task prompt: question, scope, relevant context, source requirements, and expected output. Inline evidence outside the repository; children can read only their repository checkout.
- Give parallel researchers distinct scopes and ask them to return sources and findings, not to produce or edit the final deliverable.
- Explicitly tell every researcher not to delegate or spawn further agents.
- Replace or retry a failed researcher only when useful; do not duplicate work that another researcher is already doing.

The parent agent remains the orchestrator and final synthesizer. It must:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Reconcile the researchers' findings and uncertainties rather than concatenating their responses.
3. Answer in chat by default, with citations for each material claim and clear uncertainty where evidence is incomplete.
4. Create a durable research file only when the user requests one, the repository explicitly expects research artifacts, or another agreed workflow needs one. When saving, follow the repository's existing convention and report the path.
