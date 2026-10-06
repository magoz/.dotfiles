# OpenCode 2 assessment alongside Pi

Target: `@opencode/cli` **2.0.3** (source tag commit
`d44b52ca66b6bf69626c0384626d1a9cd9555977`). Installers follow stable;
re-run compatibility tests before assessing a newer release.

Pi remains installed, configured independently, and the shared worktree default.
No Pi credentials/sessions are imported and no Pi extension is required by OpenCode.

## Available

| Capability | OpenCode path |
| --- | --- |
| Editing/navigation | Existing native Vim compatibility in `cli.json` |
| Herdr presence | Unmodified vendored official V12 TUI bridge |
| Provisioned handoff | `create_worktree` / `/worktree`: native worktree (`worktrees` strategy) + fresh session; any client |
| Mixed-agent inventory/cleanup | Pane-local `/worktrees`; shared `worktree-manage` |
| Delegation | Native `general`, `explore`, `pr-reviewer`, `web-researcher` |
| Delivery/research skills | Shared `~/.agents/skills`, harness-neutral text; `/<id>` via `skill-commands` |
| Shell-condition wake | `until` (pi-until parity): watches, recurring wakes, durable, no consent prompt |
| Allowance | `/quota` / `/subscription-usage`, cached on-demand OAuth snapshot |
| Fleet (all Box sessions) | Needs-me sidebar, footer badge, `/fleet` page (`ctrl+x f`), next needs-me (`ctrl+x j`), launcher (`ctrl+x o`), handled/undo (`ctrl+x h`/`z`) |
| Compaction/search/questions/MCP | Native V2; executor MCP uses native Code Mode |
| Claude pool (`subs-claude`) | CLIProxyAPI gateway; `subs-claude-gateway` shapes requests (Pi parity), fails closed via sentinel baseURL |

Default model: `subs-claude/claude-opus-5-5` (build/plan `#high`). Child roles stay on Astra:
general/reviewer high, explore low, web research medium.
Read-only children deny all actions except their explicit read/search allowlists;
children cannot delegate. Pi acceptance/intercom/fork parameters are not emulated.
Parent owns verification, frozen evidence, mutation ownership and synthesis.
Child read allowlists repeat the ordered global secret exclusions after `read:*`,
preserving the `.env.example` exception. This protects native read authorization,
not shell/grep content access; it is not a complete sandbox. External-directory
access stays denied for children, except read-only children may read local repos
(`~/dev/repos/**`) and managed references (`~/.local/share/opencode/repos/**`) so
project `references` such as `../yolk-sdk` work.

PR reviews target an immutable commit checked out cleanly in the repository the
reviewer reads; base/head SHA, diff digest, file inventory and evidence go inline in
the child prompt (see shared `pr` skill). A frozen patch is an alternative only when
it fits inline. Children never read external bundle paths.

Quota provider failures consistently retain same-verified-identity stale data for
strictly less than 24h from the last success, never across failed auth checks or
caller/unload cancellation. Native RPC cancellation reaches fetch/stream reads;
64 KiB response limit is enforced while reading. See subscription-usage README
for overlap, retry/backoff and TUI route-change boundaries.

## Worktrees

```sh
worktree create --help
# Existing default stays Pi; opt in explicitly for OpenCode:
worktree create --agent opencode --branch feat/example
# Inspect/manage only from the intended Herdr pane:
worktree-manage list --cwd "$PWD"
```

The model tool `create_worktree` (and `/worktree`) runs on the server with no TUI
and no Herdr, so it works the same from the web app, Fleet and the TUI. It requires a
root session and the user's explicit request; there is no confirmation prompt.
Vercel linkage is checked before allocation and produces `vercel_link_required` for
safe, verified agent recovery. It then calls native `worktree.create` (the `worktrees`
strategy) and starts a fresh session there with the task. See
`plugins/dotfiles-tools/README.md`.

The source session stays open and the destination owns the implementation. Failures
preserve resources: inspect before retrying.

`/worktrees` inventories all harnesses, checks both test/default and recorded leases,
then confirms a fingerprint of repository/branch/HEAD/lease IDs before retirement.
Live protected/default leases are refused before any release. Releases precede
checkout/workspace removal; this TUI retains Git branches. CLI optional branch
cleanup uses non-forced `git branch -d`. Dirty/current/unknown/working targets are
refused. Private fsync'd receipts retain IDs and partial progress; incomplete
receipts block further mutations until reconciled. This is not a distributed lock:
do not run another lifecycle mutator or start a writer during retirement.

**Do not use the existing Pi-only worktree dashboard for mixed/OpenCode assessment
worktrees.** It cannot account for OpenCode writers; it is intentionally unchanged.

## Skill and agent sources

Skills and agents are centralized in the `agents` Stow package (`~/.agents`):

- `~/.agents/skills/<id>/SKILL.md`: the only skill copies. OpenCode loads them
  through its native `~/.agents` compatibility source; Pi through its own discovery.
  Text is harness-neutral: name agents, say "ask the user"/"load skill `x`"; no
  harness tool shapes. `metadata.opencode/slash: "true"` registers `/<id>` via
  `plugins/skill-commands` (V2 removed native skill slash commands in v2.0.4).
- `~/.agents/agents/<name>.md`: Pi-format agent definitions, read natively by
  pi-subagents. `scripts/sync-agents.mjs` generates `agents/*.md` (OpenCode
  model#variant + deny-first permissions); `npm test` fails when they are stale.

Custom compaction/toggle is not ported. Dependency install scripts stay disabled so
packages cannot modify global commands or shared skills.

## Verification and remaining gates

```sh
npm test --prefix home/opencode/.config/opencode
npm run test:native --prefix home/opencode/.config/opencode  # installed 2.0.3, isolated HOME
bun run --cwd home/scripts/.local/share/worktree test
bun run --cwd home/scripts/.local/share/worktree typecheck
bun run --cwd home/scripts/.local/share/sandbox-db test
bun run --cwd home/scripts/.local/share/sandbox-db typecheck
bash arch/tests/run
bash macos/tests/run
```

Synthetic plugin/CLI tests and an isolated-HOME native plugin/agent/skill inventory
smoke cover activation and safety contracts. They do not prove a complete live
workflow. Manual assessment still needs: authentication, quota-provider responses,
interactive Vim/Herdr state, a controlled provisioned handoff,
renewal/retirement, delegation, compaction, and delivery-skill completion.

No provisioned user worktrees, database allocations/deletions, PR mutations, model
requests or Herdr pane changes are used for these checks. Git fixture tests use
throwaway temporary repositories. Quota is a snapshot dialog, not Pi-footer parity.

`subs-claude` was verified against OpenCode 2.0.20 only with a fake local server in an
isolated network namespace (prompt/tool fingerprints, checkpoint reasoning, cross-provider
reasoning, headers, fail closed), then live through a blocking gate (see plugins/subs-claude-gateway/README.md).
On the upgrade to 2.0.22 the fixtures were re-captured (`fixtures/capture.sh`) and re-checked;
the live gate was not repeated. The
old direct-mode Anthropic OAuth plugin (never loaded on 2.0.20) was removed.

Root dependency audit currently reports four vulnerable transitive packages
(hono, toml, uuid, ws) in the legacy dependency graph. No blanket audit fix was applied; assess
updates separately rather than silently changing compatibility-critical packages.
Independent review completed and identified secret-read precedence, external frozen
bundle delivery and inconsistent stale quota fallback defects. These are addressed
with focused offline regressions, along with request cancellation/streaming bounds.
Fresh independent read-only follow-up confirmed all three findings resolved, with
no new actionable defects (verdict: OK with notes). Validation: 74 Node + 5 Bun
tests, independent native-matcher/transport/quota regressions, and isolated V2.0.3
smoke. Live end-to-end assessment remains untested. Pi was not changed.
