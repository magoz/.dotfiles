# XDG Paths
export XDG_CONFIG_HOME=$HOME/.config
export XDG_CACHE_HOME=$HOME/.cache
export XDG_DATA_HOME=$HOME/.local/share

# zsh config dir
export ZDOTDIR=$HOME/.config/zsh

# Homebrew environment for login shells. Use stable paths instead of invoking
# `brew shellenv`; interactive shells repeat these assignments without forks.
export HOMEBREW_PREFIX="/opt/homebrew"
export HOMEBREW_CELLAR="$HOMEBREW_PREFIX/Cellar"
export HOMEBREW_REPOSITORY="$HOMEBREW_PREFIX"
typeset -U path PATH
path=("$HOMEBREW_PREFIX/bin" "$HOMEBREW_PREFIX/sbin" $path)
case ":${MANPATH:-}:" in
  *":$HOMEBREW_PREFIX/share/man:"*) ;;
  *) export MANPATH="$HOMEBREW_PREFIX/share/man:${MANPATH:-}" ;;
esac
case ":${INFOPATH:-}:" in
  *":$HOMEBREW_PREFIX/share/info:"*) ;;
  *) export INFOPATH="$HOMEBREW_PREFIX/share/info:${INFOPATH:-}" ;;
esac
