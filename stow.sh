#!/usr/bin/env bash
set -euo pipefail

# Set current directory in case the script is called from elsewhere.
cd "$(dirname "$0")"

echo "🔗 Running stow..."

stow -R stow
stow -R nvim
stow -R wezterm
stow -R ghostty
stow -R zsh
stow -R tmux
stow -R git
stow -R lazygit
stow -R opencode
stow -R agents
mkdir -p "$HOME/.pi/agent"
stow -R pi
stow -R aerospace
stow -R borders
stow -R leaderkey
stow -R scripts

if command -v bun >/dev/null 2>&1; then
  echo "📦 Installing opencode deps..."
  bun install --cwd "$PWD/opencode/.config/opencode"
else
  echo "⚠️ bun missing; skipped opencode deps"
fi

if command -v npm >/dev/null 2>&1; then
  echo "📦 Installing Anthropic plugin deps..."
  npm ci --prefix "$PWD/opencode/.config/opencode/plugins/opencode-anthropic-auth"
  echo "📦 Installing Pi extension deps..."
  npm ci --omit=dev --prefix "$HOME/.pi"
else
  echo "⚠️ npm missing; skipped Anthropic plugin and Pi extension deps"
fi

echo "✅ Stow complete"
