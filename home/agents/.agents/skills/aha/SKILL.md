---
name: aha
description: Create and share an "aha" — one self-contained HTML page that explains something (a concept walkthrough, comparison, visual explainer, or plan) — with the Aha CLI. Use when the user wants an explanation or document they can open in a browser and share by URL.
---

If subagents are available, optionally launch the `aha` subagent and relay its URL.
Give it a self-contained task prompt: what the page should cover and for whom,
relevant content, and the existing id when revising a page. Read the canonical
workflow below and inline its instructions and any needed external evidence;
children cannot read outside their repository checkout. Otherwise, do it yourself:

Read `~/aha/SKILL.md` for the canonical workflow, the house document style, and the
security rules before using Aha. The application and CLI source live in that
separate repository, not in dotfiles. Invoke `aha` from the document's working
directory; do not change into the repository to run it.

Uploads are private by default. Publish or unpublish only on explicit owner
instruction. If the checkout or command is missing, explain the local setup
requirement; do not install an unrelated npm package named `aha`.
