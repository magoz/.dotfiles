---
name: plans
description: Upload, update, read, list, publish, or unpublish self-contained HTML documents with the Plans CLI. Use when the user wants to share an HTML report, plan, or document through Plans.
---

Read `~/plans/SKILL.md` for the canonical workflow and security rules before using
Plans. The application and CLI source live in that separate repository, not in
dotfiles. Invoke `plans` from the document's working directory; do not change into
the repository to run it.

Uploads are private by default. Publish or unpublish only on explicit owner
instruction. If the checkout or command is missing, explain the local setup
requirement; do not install an unrelated npm package named `plans`.
