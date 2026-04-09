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

## Updating

If Anthropic breaks OAuth again:

1. inspect upstream issue/PR threads first
2. port only minimal behavior needed
3. preserve local auth flow unless intentionally changing provider behavior

## Guardrails

- keep provenance comments current
- document every Anthropic-specific workaround here
- prefer minimal diffs; this file will drift from upstream over time
