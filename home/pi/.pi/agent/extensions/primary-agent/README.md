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
      "workers": ["general", "explore", "pr-reviewer", "web-researcher"],
      "models": [
        { "id": "provider/model-id", "guidance": "Prefer for UI implementation." }
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
| Main coding agent and `pr-reviewer` | `openai-codex/gpt-6-astra` |
| UI implementation (public or private repo) | `anthropic/claude-fable-5-1` |
| Other implementation in a verified public repo | `opencode-go/muse-spark-1.3-contributor` |
| Other implementation in a private/unknown-visibility repo | `xai/grok-4.6` |
| `explore` and `web-researcher` | `xai/grok-4.6` |

`general` defaults to `xai/grok-4.6` so omitting a launch override does not inherit
the frontier parent model. Coding explicitly selects `anthropic/claude-fable-5-1`
for UI implementation or `opencode-go/muse-spark-1.3-contributor` for other
public-repository implementation. UI routing takes precedence over the general
implementation split. Before using `opencode-go/muse-spark-1.3-contributor`, coding
must verify the actual repository is public and that the handoff contains no private
material; a remote URL alone is not proof of visibility. Unknown visibility routes
to `xai/grok-4.6`.

`openai-codex/gpt-6-astra` is already Pi's configured main-model default. Identity activation still
preserves a manually selected model. Unavailable worker models must be reported;
trying an alternative requires a later explicit pi-subagents launch, checking any
partial work first and preserving the visibility constraint. No automatic fallback
chain is configured. Exact model IDs and routing prose live in `primary-agents.json`.

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
