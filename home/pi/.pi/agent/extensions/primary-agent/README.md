# Primary agent

A local, same-session identity layer for Pi 0.85.1. Inspired by Pi's official
[`preset.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/examples/extensions/preset.ts)
example, but deliberately **never changes the model, thinking level, tools, or
conversation**. It does not launch workers or replace pi-subagents.

## Usage

After applying the Pi Stow package, run `/reload` in the existing conversation.

| Command | Effect |
| --- | --- |
| `/agent` | Pick a primary identity; Escape leaves it unchanged |
| `/agent coding` | Activate the coding identity in this session |
| `/agent status` | Inspect identity, definition path, and configured roster |
| `/agent clear` | Persistently clear the identity on this branch |
| `/model` | Change the model independently; identity remains selected |

The footer shows `agent:coding`. Selection requires an idle agent. Clearing an
identity does not cancel already running workers or undo earlier work.

## Definitions

`~/.pi/agent/primary-agents.json` (or the directory returned by Pi's `getAgentDir()`):

```json
{
  "default": "coding",
  "agents": {
    "coding": {
      "description": "Architecture, supervision, and delivery",
      "prompt": "primary-agents/coding.md",
      "workers": ["general", "ui-design", "explore-codebase", "pr-reviewer", "web-researcher"],
      "models": [
        { "id": "provider/model-id", "guidance": "Prefer for UI design." }
      ]
    }
  }
}
```

- `prompt` is required; paths resolve relative to the JSON file.
- Description, workers, and models are optional. Agent names use lowercase letters,
  digits, and hyphens; `clear` and `status` are reserved.
- `models` lists model preferences as `{ "id": "provider/model", "guidance": "…" }`
  objects. Guidance is optional; plain `"provider/model"` strings remain supported.
  Full guidance is included in the system prompt and `/agent status`, including
  after compaction/resume. These are user routing preferences, not benchmark claims.
- The roster is prompt guidance, not an automatic dispatcher, enforced allowlist,
  or runtime privacy gate. It never changes the main model. Worker defaults live
  in their own frontmatter; coding uses explicit per-launch overrides when needed.
- Workers remain defined in `~/.pi/agent/agents/` and managed by pi-subagents.
  Primary prompts live separately so they are not discovered as workers.
- Live capability discovery, model lookup, authentication, and execution preflight
  remain pi-subagents' responsibility. A configured entry is not availability proof.
- Set `default` to `null` (or omit it) for opt-in activation. The tracked config
  defaults to `coding`. No project-local override or extra launch flag is added.
- Unknown fields are rejected, including parent `model`, `thinkingLevel`, or
  `tools` settings. There is intentionally no permissions engine here.

The coding identity owns architecture, judgment, supervision, and outcomes. It
provides standing authorization for coding-related delegation, while respecting
narrower user/repository/skill/tool constraints. Direct work remains appropriate;
no mandatory phases or delegation quota are imposed.

### Configured coding routing

| Work | Preferred model |
| --- | --- |
| Main coding agent | `subs-codex/gpt-6-astra` |
| `pr-reviewer` | `anthropic/claude-opus-5-5` (default); the PR skill also requests `subs-codex/gpt-6-astra` for a secondary independent opinion |
| `tech-lead` | `anthropic/claude-opus-5-5` (default); automatic fallback to Astra, then public-only Muse; no further fallback |
| `ui-design` (public or private repo) | `anthropic/claude-opus-5-5` |
| `general` implementation, including UI, in a verified public repo | `opencode-go/muse-spark-1.3-contributor` |
| `general` implementation, including UI, in a private/unknown-visibility repo | `subs-codex/gpt-6-sol`; automatic `xai/grok-4.7`, then `zai/glm-5.3`, fallback for availability/auth/quota failures |
| `explore-codebase` in a verified public repo | `opencode-go/muse-spark-1.3-contributor` via explicit per-launch override |
| `explore-codebase` in a private/unknown-visibility repo | `opencode-go/deepseek-v4.1-flash` |
| `web-researcher` | `opencode-go/deepseek-v4.1-flash` |

The configured models do not have overlapping provider routes. On availability,
authentication, or quota failure, coding moves directly to the next model in the
automatic fallback chain instead of retrying the same model through another provider.
Explicit user provider/model selection determines the initial model; fallback remains
automatic unless the user explicitly requires that exact model or forbids fallback.
Inspect partial work, then start each fallback as a new explicit pi-subagents launch
without waiting for user confirmation. Report the exact failed model, reason, and
selected fallback so the transition is observable. Unrelated tooling or workflow
failures remain infrastructure blockers. Fallback never changes the execution engine.

The PR skill uses two fresh-context `pr-reviewer` children when both models are
available: Opus (primary) and Astra (secondary) independently review the same frozen patch and assigned
criteria, not different axes. Each can cover Standards, Spec, and Knowledge in one
report with separate axis verdicts. The skill owns availability handling, evidence
reuse, and parent reconciliation; outside it, `pr-reviewer` runs on its Opus 5.5
default. Astra occupies one model slot through its configured Subs route.
Single-axis reviewer assignments remain supported.

`ui-design` is a read-only design specialist: it produces design direction,
interaction specifications, and actionable implementation guidelines. The parent
passes accepted guidelines to `general` for UI implementation; an already settled
design does not require another design pass. Design proposals do not authorize
production edits, and the designer reports any browser/visual validation gaps.

`general` defaults to `subs-codex/gpt-6-sol` so omitting a launch override does not inherit
the frontier parent model. Coding explicitly selects
`opencode-go/muse-spark-1.3-contributor` for public-repository implementation
(including UI) and `explore-codebase`. Before using `opencode-go/muse-spark-1.3-contributor` by default,
coding verifies the actual repository is public and that the handoff contains no private
material; a remote URL alone is not proof of visibility. Unknown visibility routes
to `subs-codex/gpt-6-sol` for implementation (including UI), then `xai/grok-4.7`,
and finally `zai/glm-5.3` if earlier models are unavailable. Unknown visibility still routes
to `opencode-go/deepseek-v4.1-flash` for `explore-codebase` by default. An explicit user
instruction to use a specific model overrides this default visibility routing; coding
confirms the requested scope and proceeds with the user's choice.

When Sol is unavailable, authentication fails, or quota is exhausted, the parent
inspects any partial work and automatically starts a new explicit pi-subagents launch
with `xai/grok-4.7`, without waiting for user confirmation. If Grok also fails,
the parent continues with `zai/glm-5.3`. No second provider route is attempted for any
model. GPT Sol, Grok, and GLM are eligible for private/unknown-visibility work, and the parent
reports each failed model, reason, and selected fallback so the automatic switch is not
silent. Unrelated launch/tooling/workflow failures remain infrastructure blockers, not
fallback triggers.

`subs-codex/gpt-6-astra` is already Pi's configured main-model default. Identity activation still
preserves a manually selected model. All configured provider/model fallback chains are
automatic for availability, authentication, and quota failures. When no explicit chain
is defined, coding selects the closest suitable permitted model for the role while
preserving repository-visibility and privacy constraints. Automatic means the parent
starts a new explicit pi-subagents launch after inspecting partial work; it is not an
opaque in-run model substitution. Exact model IDs and routing prose live in
`primary-agents.json`.

Only the Subs Codex routes participate in worker model routing. Direct-Codex profiles
may remain in `context-budget.json`, but they are not fallback candidates. Subs model
registrations currently declare a 272,000-token context window; full-context profiles
are deferred until the gateway's supported larger limits are verified.

## Lifecycle

Selection is stored immediately as a versioned `primary-agent:selection` custom
session entry, including an explicit `null` on clear. These entries are not LLM
messages. Restore uses the active **branch**, not every entry in the session file.

Startup, `/reload`, resume, new sessions, forks, and tree navigation restore the
selection. Compaction retains the entries; instructions are appended to the
current chained system prompt on each new agent run, not copied into conversation
history. Existing repository instructions and tools remain intact.

A branch without selection state receives the configured default once, including
an explicit "none" when no default exists. Later default changes do not override
saved selections. Pi's normal persistence rules still apply: `--no-session` is
ephemeral, and an otherwise empty session is written after its first assistant
response.

State stores the identity **name**, not a frozen prompt. `/reload` or reselecting
an identity loads current definitions. Missing/broken active definitions show an
error indicator and a deduplicated warning, never silently select another agent.
`/agent clear` remains usable even with broken configuration. A failed switch
leaves the previously working identity intact.

## Worker isolation and startup

- Background pi-subagents runners set `PI_SUBAGENT_CHILD=1`: the factory registers
  nothing, even if ambient extensions are enabled.
- Foreground workers are in-process SDK sessions, with ambient extensions disabled.
  If this extension is explicitly included, lifecycle/command/prompt handlers ignore
  pi-subagents' leading `<active_agent name="…"/>` system-prompt tag. Copied/forked
  selection entries cannot activate a primary identity there.
- These integration assumptions were checked against pi-subagents **0.68.0**.
  Recheck its child-launch contract when upgrading; arbitrary third-party runners
  are outside this extension's scope. Do not add primary-agent to worker extensions.
- The entrypoint only registers handlers. One cached import loads the small runtime
  and host SDK when first needed. Startup performs required local config/prompt
  reads only: no directory scans, processes, network calls, or worker discovery.

## Verification

```sh
npm --prefix home/pi/.pi run check --workspace=primary-agent
npm --prefix home/pi/.pi run test --workspace=primary-agent
```

Tests cover model/tool/session invariants, explicit clear, disk resume and fork,
compaction, branch restoration, error recovery, UI selection, lightweight import
registration, and root/child command dispatch through the real Pi SDK loader.
No inference requests are made.

Local startup-to-no-op-command measurements (offline print mode, fresh Pi processes,
seven alternating measured samples after warmup): baseline median **216 ms**;
primary-agent with coding config **215 ms**. The difference is within noise, not a
speedup claim. Full configured extension set with primary-agent: **565 ms** median
(three measured samples). This measures CLI startup, not interactive TUI latency.
