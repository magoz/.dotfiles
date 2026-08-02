---
name: research
description: Investigate a question against high-trust primary sources and synthesize cited findings. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to background agents.
---

Delegate the reading legwork through Pi's native subagent mechanism so research can proceed without consuming the main agent's context. **Do not launch a nested Pi CLI, terminal pane, or other process as a substitute for a subagent.** If native subagents are unavailable, research directly in the current session.

## Delegation strategy

Choose the number of researchers based on the work rather than a fixed limit:

- Use one focused researcher for a narrow question.
- Fan out to multiple researchers when the question has genuinely independent tracks, source domains, or competing claims worth checking separately.
- Give parallel researchers distinct scopes and ask them to return sources and findings, not to produce or edit the final deliverable.
- Explicitly tell every researcher not to delegate or spawn further agents.
- Replace or retry a failed researcher only when useful; do not duplicate work that another researcher is already doing.

The parent agent remains the orchestrator and final synthesizer. It must:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Reconcile the researchers' findings and uncertainties rather than concatenating their responses.
3. Answer in chat by default, with citations for each material claim and clear uncertainty where evidence is incomplete.
4. Create a durable research file only when the user requests one, the repository explicitly expects research artifacts, or another agreed workflow needs one. When saving, follow the repository's existing convention and report the path.
