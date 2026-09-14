# Plannotator native V2 wrapper

Pinned upstream `@plannotator/opencode` 0.27.14 default export. The only local
behavior selects the OpenCode-private CLI at `~/.config/opencode/bin/plannotator`
when `PLANNOTATOR_BIN` is unset/blank. This is a process-wide OpenCode installation
path, never pane-local state; global PATH and Pi defaults are untouched.

Install with `bun ~/.config/opencode/scripts/install-plannotator.mjs`. The helper
uses pinned immutable-release binary hashes and writes no hooks/shared skills.
A differing existing binary is never overwritten. Package lifecycle scripts stay
disabled. The `plannotator-skills` alias points at the repository package install,
so skill loading does not depend on a separate user-home node_modules install.

Native activation and private CLI `--version` checked; interactive review remains
an assessment gate. Read `../../ASSESSMENT.md` before live testing.
