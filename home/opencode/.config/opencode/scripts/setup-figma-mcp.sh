#!/usr/bin/env bash
# Usage: bash ~/.config/opencode/scripts/setup-figma-mcp.sh
exec bun "$(dirname "$0")/setup-figma-mcp.ts" "$@"
