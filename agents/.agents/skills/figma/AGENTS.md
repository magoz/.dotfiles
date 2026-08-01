# Maintaining the Figma skills

This directory contains the locally authored `figma` router. It is installer and maintainer documentation, not part of the skill instructions.

## Upstream source

The sibling official skills come from Figma's MCP plugin repository:

- Repository: <https://github.com/figma/mcp-server-guide>
- Skills: <https://github.com/figma/mcp-server-guide/tree/main/skills>
- Version: `.claude-plugin/plugin.json`

Record the upstream version and commit when updating.

## Update procedure

1. Clone or download the latest `figma/mcp-server-guide`.
2. Synchronize its `skills/figma-*` directories into the parent `skills/` directory.
3. Add new upstream skills and remove official skills that no longer exist upstream.
4. **Do not overwrite or remove:**
   - `figma/` — local router and this file
   - `figma-import-image/` — local legacy fallback, not an upstream skill
5. Reapply `disable-model-invocation: true` to every `figma-*` leaf `SKILL.md`. Only the `figma` router should be model-visible.
6. Keep the OpenCode skill permissions configured so `figma-*` is denied and `figma` is allowed.
7. Check whether the local relative-link fix is still needed in:
   `figma-use/references/working-with-design-systems/wwds-variables.md`.
   The link to `figma-generate-library/references/token-creation.md` must use `../../../` from that file.
8. Update the router when upstream adds, removes, or renames a workflow.

Do not copy upstream MCP configuration or plugin manifests; only synchronize the skill directories.

## Validation

After updating:

- Confirm every leaf has `disable-model-invocation: true`.
- Confirm Pi loads all Figma skills with no diagnostics and exposes only `figma`.
- Run `opencode debug config` and `opencode debug skill`.
- Verify all relative Markdown links resolve.
- Compare against upstream and review every remaining local difference.
