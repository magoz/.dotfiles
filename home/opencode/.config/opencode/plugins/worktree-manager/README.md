# Worktree manager TUI

Native pane-local `/worktrees`: list Pi + OpenCode worktrees, renew databases for
7d, or explicitly confirm retirement (target/workspace/database releases shown).
Retirement passes the exact plan token, pinning repository, branch, HEAD and lease
IDs—not merely lease names. Both live lease guardrails are checked first.
Git branch always retained by this UI. Current source remains open. No server
plugin, RPC, model call, broadcast, focus change or automatic retry.

Loaded through `cli.json`. Install the scripts package
with `worktree-manage` on PATH. Uses the sibling dotfiles-tools `process.js` runner,
with the TUI's own `process.env`, never the shared server environment.

Native `keymap.layer`, `ui.dialog.select/confirm` contracts checked against
`/tmp/opencode-v2-assessment/packages/plugin/src/tui/context.ts`.
The subprocess runner must honor `cleanupGraceMs: 3000` so the inner worktree CLI's
2-second descendant cleanup completes before the outer runner kills its leader.

Failures intentionally show no raw command output; inspect private manager receipts
and use the headless CLI for sanitized refusal details. Partial/unknown receipts
require manual reconciliation. Successful receipts remain archived. Existing Pi
dashboard is Pi-only: use this manager for mixed worktrees.

Tests: `bun test ./home/opencode/.config/opencode/plugins/worktree-manager/tui.test.js`
