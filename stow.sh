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

echo "✅ Stow complete"
