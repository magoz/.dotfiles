# Box needs its managed command path in every Zsh mode, including remote SSH
# commands that run as non-interactive `zsh -c` sessions.
if [[ $OSTYPE != darwin* && -r "$HOME/.config/box/shell-env.sh" ]]; then
  source "$HOME/.config/box/shell-env.sh"
fi

# Non-login interactive shells do not read ~/.zprofile, so point them at the
# shared configuration before Zsh looks for .zshrc. Login shells inherit the
# same setting from ~/.zprofile; non-interactive shells need no UI config.
if [[ -o interactive && ! -o login ]]; then
  export XDG_CONFIG_HOME="$HOME/.config"
  export XDG_CACHE_HOME="$HOME/.cache"
  export XDG_DATA_HOME="$HOME/.local/share"
  export ZDOTDIR="$HOME/.config/zsh"
fi
