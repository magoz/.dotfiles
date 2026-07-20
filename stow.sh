#!/bin/bash
set -e

# set current directory, in case the script is called from another directory.
cd "$(dirname "$0")" || exit

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
else
  echo "⚠️ npm missing; skipped Anthropic plugin deps"
fi

echo "✅ Stow complete"
