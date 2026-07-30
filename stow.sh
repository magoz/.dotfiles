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

# Stow refuses to adopt an absolute symlink, even when it already points to
# this package. Remove that legacy link so Stow can recreate and own it.
if [[ -L "$HOME/.agents" ]] &&
  [[ "$(readlink "$HOME/.agents")" == "$PWD/agents/.agents" ]]; then
  rm "$HOME/.agents"
fi
stow -R agents
mkdir -p "$HOME/.pi/agent"
stow -R pi
stow -R aerospace
stow -R borders
stow -R leaderkey
stow -R scripts

echo "✅ Stow complete"
