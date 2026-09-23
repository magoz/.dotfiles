---
name: aha
description: Create and share an "aha" — one self-contained HTML page that explains something (a concept walkthrough, comparison, visual explainer, or plan) — with the Aha CLI. Use when the user wants an explanation or document they can open in a browser and share by URL.
---

If you can launch Pi subagents and an `aha` agent is available, delegate: launch
`aha` with only the content request (what the page should cover and for whom,
plus the existing id when revising a page) and relay its URL. Don't restate the
workflow or rules; the agent carries them. Otherwise, do it yourself:

Read `~/aha/SKILL.md` for the canonical workflow, the house document style, and the
security rules before using Aha. The application and CLI source live in that
separate repository, not in dotfiles. Invoke `aha` from the document's working
directory; do not change into the repository to run it.

Uploads are private by default. Publish or unpublish only on explicit owner
instruction. If the checkout or command is missing, explain the local setup
requirement; do not install an unrelated npm package named `aha`.
