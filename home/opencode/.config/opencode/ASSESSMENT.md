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
| Provisioned handoff | Pane-local `create_worktree`; shared CLI `--agent opencode` |
| Mixed-agent inventory/cleanup | Pane-local `/worktrees`; shared `worktree-manage` |
| Delegation | Native `general`, `explore`, `pr-reviewer`, `web-researcher` |
| Delivery/research skills | Canonical shared skills + OpenCode runtime adapters |
| Review UI | Pinned Plannotator 0.27.14, native V2 wrapper |
| Shell-condition wake | Session-owned `until`, explicit local consent |
| Allowance | `/quota` / `/subscription-usage`, cached on-demand OAuth snapshot |
| Compaction/search/questions/MCP | Native V2; executor MCP uses native Code Mode |

Astra variants: build/plan/general/reviewer high, explore low, web research medium.
Read-only children deny all actions except their explicit read/search allowlists;
children cannot delegate. Pi acceptance/intercom/fork parameters are not emulated.
Parent owns verification, frozen evidence, mutation ownership and synthesis.
Child read allowlists repeat the ordered global secret exclusions after `read:*`,
preserving the `.env.example` exception. This protects native read authorization,
not shell/grep content access; it is not a complete sandbox. External-directory
access remains denied for children.

Frozen PR review bundles are delivered **INLINE through native `subagent.prompt`**:
complete sanitized exact UTF-8 patch, Git blob digest, one immutable target, one
axis, scope/specification, changed-file inventory, validation and guidance evidence.
Parent still freezes outside the repository but never sends only those paths or Pi
`reads` parameters. The small skill-adapters transport helper checks bytes/digest,
required fields and an explicit complete-prompt budget (256 KiB ceiling); parent
must also confirm actual native model context fit. Missing/unrepresentable evidence
or a bundle that cannot fit blocks; never truncate, hash different bytes or open
broad filesystem access. See the adapter README; canonical policy/digests unchanged.

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

The model tool executes through the exact live TUI, never the shared server's
inherited Herdr environment. It requires a root session, unique binding, idle
children, and confirmation of exact setup operations. Ambiguity/cancellation
revokes the request before subprocess launch. Vercel linkage is checked before
allocation and produces `vercel_link_required` for safe, verified agent recovery.

Successful handoff **does not exit the source TUI**. Destination owns implementation;
stop source work and exit only that source manually. Never broadcast exit or stop
the shared server. Failures preserve resources: inspect before retrying.

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

## Skill source safety

`shared-skills` is a symlink to the canonical shared skill directory. Its distinct
source path is deliberate: V2 deduplicates source paths *before* applying precedence,
so explicitly repeating `~/.agents/skills` would not override older OpenCode copies.
The alias wins without deleting those copies or changing shared files.

Runtime adapters retain canonical locations/supporting files and preserve policy
gates; `sources.json` is an id allowlist, not content digests, so changed
canonical skills adapt without a blocking review gate. V2 loads config
skills after user plugins; adapters re-register on plugin updates and synchronously
at prompt/tool/context boundaries. Context guidance also covers already-persisted
raw skill activations. Custom compaction/toggle is not ported; old aliases explain native
compaction instead. Dependency install scripts are disabled to prevent Plannotator
postinstall from modifying global commands/skills. Plannotator's CLI is installed
separately into `~/.config/opencode/bin/plannotator`, pinned to 0.27.14 with reviewed
release SHA-256 checksums. No global binary, Pi hook or shared skill is replaced.
The native wrapper selects that private binary (explicit `PLANNOTATOR_BIN` wins).
For CLI-only skills, use that full path. Both platform installers invoke the helper;
standalone setup: `bun ~/.config/opencode/scripts/install-plannotator.mjs`.
An existing differing binary is preserved and requires deliberate upgrade inspection.

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
interactive Vim/Herdr state and Plannotator UI, a controlled provisioned handoff,
renewal/retirement, delegation, compaction, and delivery-skill completion.

No provisioned user worktrees, database allocations/deletions, PR mutations, model
requests or Herdr pane changes are used for these checks. Git fixture tests use
throwaway temporary repositories. Quota is a snapshot dialog, not Pi-footer parity.

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
