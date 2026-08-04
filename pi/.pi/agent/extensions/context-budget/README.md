# Context Budget

A lightweight Pi extension for selecting the effective context window Pi uses for footer reporting, overflow handling, and automatic compaction.

The bundled configuration defines two profiles for `openai-codex/gpt-5.6-sol`:

- `short`: 272,000 tokens
- `full`: 1,050,000 tokens

Both profiles keep the real provider and model ID. The selected budget is local Pi metadata and is not sent to OpenAI.

## Installation

```sh
pi install npm:pi-context-budget
```

Restart Pi after installation. The extension works immediately with its bundled Sol profiles; a configuration file is optional.

## Usage

```text
/context-budget
/context-budget short
/context-budget full
/context-budget status
```

The default shortcut is `Alt+Shift+C`. It cycles through the configured profiles.

If Pi is streaming, a selection is recorded as pending and applied automatically on `agent_settled`; the in-flight request is not changed or interrupted. Only the latest pending selection is applied.

When a smaller budget is selected and current usage exceeds `contextWindow - 16,384`, the extension starts Pi compaction without prompting.

## Configuration

Global configuration:

```text
~/.pi/agent/context-budget.json
```

Trusted projects may override model profile definitions and defaults with:

```text
<project>/.pi/context-budget.json
```

Example:

```json
{
  "shortcut": "alt+shift+c",
  "models": {
    "openai-codex/gpt-5.6-sol": {
      "defaultProfile": "short",
      "profiles": {
        "short": 272000,
        "full": 1050000
      }
    }
  }
}
```

Each configured model must define at least two lowercase profiles with integer token budgets greater than 16,384. The name `status` is reserved, and the default profile must name one of the configured profiles.

The shortcut is read only from the global file because Pi resolves project trust after extension shortcuts are registered. Project-local `shortcut` values are ignored. Run `/reload` after changing profile definitions or the global shortcut.

Profile selections are stored as custom session entries. They are branch-aware, survive compaction, and are not included in model context. New sessions use the configured default.

## License

MIT
