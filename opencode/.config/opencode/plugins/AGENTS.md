# Plugins

Local OpenCode runtime plugins.

## Current plugin

- `opencode-anthropic-auth.mjs`

## Why this plugin exists

Local Anthropic OAuth auth for OpenCode without installing external plugin packages at runtime.

Base source:

- repo: `seaweeduk/opencode-anthropic-auth`
- commit: `072096f0a1dcaac2fd0f0eff611a64982d483e84`

## Local patches

### 1. Claude identity system prompt

We force Claude identity for Anthropic provider requests:

- `You are Claude Code, Anthropic's official CLI for Claude.`

Reason: Anthropic OAuth requests are sensitive to non-Claude-Code harness fingerprints.

### 2. System prompt relocation hotfix

Problem:

Anthropic started rejecting OAuth requests with misleading 400s like:

- `Third-party apps now draw from extra usage...`
- `You're out of extra usage...`

Cherry-picked behavior from:

- repo: `griffinmartin/opencode-claude-auth`
- PR: `#148`
- commit: `bb6320cbe9c985a89258bf2ca1e027f2be7cd923`
- issue chain: `#145`, `#157`

Patch behavior:

- keep only Claude identity (+ billing header if present) in `system[]`
- move all other system text into the first user message
- avoid weaker `OpenCode` string replacement hacks

### 3. PascalCase `mcp_` tool names hotfix

Problem:

Anthropic started fingerprinting tool name casing after the `mcp_` prefix.
Lowercase names like `mcp_bash` and `mcp_read` trigger the same misleading 400 rejection.

Cherry-picked behavior from:

- repo: `ex-machina-co/opencode-anthropic-auth`
- PR: `#81`
- release: `v1.6.0`

Patch behavior:

- rewrite tool names to Claude Code style: `bash` -> `mcp_Bash`
- rewrite `tool_use` block names the same way
- strip `mcp_` on streamed responses and restore lowercase-first names

### 4. Claude Code billing/header parity hotfix

Problem:

Anthropic tightened OAuth request parity checks beyond prompt/tool names.
Old requests can fail with the same misleading usage-limit errors.

Cherry-picked behavior from:

- repo: `ex-machina-co/opencode-anthropic-auth`
- releases: `v1.5.0`..`v1.8.1`
- repo: `griffinmartin/opencode-claude-auth`
- PR: `#207`
- release: `v1.5.1`

Patch behavior:

- inject Claude Code CCH billing header into `system[0]`
- send Claude Code beta/header/user-agent parity fields
- use current `platform.claude.com` OAuth URLs/scopes
- dedupe token refresh and re-read auth before refresh

### 5. Prompt/stream edge hotfixes

Problem:

Anthropic added another OpenCode prompt fingerprint and tool streams can split JSON names across chunks.

Cherry-picked behavior from:

- repo: `ex-machina-co/opencode-anthropic-auth`
- PR: `#118`
- release: `v1.7.5`
- repo: `griffinmartin/opencode-claude-auth`
- releases: `v1.4.5`, `v1.5.2`

Patch behavior:

- rewrite `Here is some useful information about the environment you are running in:`
- preserve `StructuredOutput` casing when stripping `mcp_`
- strip unsupported effort fields for Haiku
- buffer streamed SSE events before stripping tool prefixes

## Updating

If Anthropic breaks OAuth again:

1. inspect upstream issue/PR threads first
2. port only minimal behavior needed
3. preserve local auth flow unless intentionally changing provider behavior

## Guardrails

- keep provenance comments current
- document every Anthropic-specific workaround here
- prefer minimal diffs; this file will drift from upstream over time
