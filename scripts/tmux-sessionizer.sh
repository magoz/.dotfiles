#!/usr/bin/env bash

# Src: https://github.com/ThePrimeagen/.dotfiles/blob/602019e902634188ab06ea31251c01c1a43d1621/bin/.local/scripts/tmux-sessionizer#L4

if [[ $# -eq 1 ]]; then
  selected=$1
else
  selected=$(
    (
      find ~/dev/core-projects/clients \
        ~/dev/core-projects/clients/duck \
        ~/dev/core-projects/afloat/local-dev-setup \
        ~/dev/core-projects/open-source \
        ~/dev/core-projects/rust \
        ~/dev/ecosystem \
        -mindepth 1 -maxdepth 1 -type d
      find ~/.dotfiles \
        ~/dev/core-projects/magoz.com \
        ~/dev/core-projects/guestbook \
        ~/dev/core-projects/archival* \
        ~/dev/core-projects/intellect/intellect-monorepo \
        ~/dev/core-projects/intellect/intellect-notes \
        ~/dev/core-projects/intellect/intellect-ai \
        ~/dev/core-projects/intellect/2022/intellect-notes \
        -mindepth 0 -maxdepth 0 -type d
    ) | fzf
  )
fi
if [[ -z $selected ]]; then
  exit 0
fi

selected_name=$(basename "$selected" | tr . _)
tmux_running=$(pgrep tmux)

if [[ -z $TMUX ]] && [[ -z $tmux_running ]]; then
  tmux new-session -s "$selected_name" -c "$selected"
  exit 0
fi

if ! tmux has-session -t="$selected_name" 2>/dev/null; then
  tmux new-session -ds "$selected_name" -c "$selected"
fi

tmux switch-client -t "$selected_name"
