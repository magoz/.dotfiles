# Zsh configuration directory
export ZDOTDIR="$HOME/.config/zsh"

# Instant prompt is intentionally disabled. It switches the terminal to
# noncanonical mode before ZLE is ready, which exposes early backspaces as ^?.

# ---------------------------------
# ------- EXPORTS & PATH ----------
# ---------------------------------
[[ ! -r "$ZDOTDIR/zsh-exports" ]] || source "$ZDOTDIR/zsh-exports"

# ---------------------------------
# ------------- PROMPT ------------
# ---------------------------------
if (( ! $+commands[starship] )); then
  # Keep a usable prompt when provisioning has not installed Starship yet.
  PROMPT='%F{cyan}%n@%m%f %F{blue}%~%f %# '
fi

# ---------------------------------
# ---------- HISTORY --------------
# ---------------------------------
typeset -g HISTFILE="$ZDOTDIR/.zsh_history"
typeset -g HISTSIZE=500000
typeset -g SAVEHIST=500000
setopt append_history
setopt inc_append_history
setopt extended_history
setopt hist_find_no_dups
setopt hist_ignore_space
setopt hist_verify
setopt share_history

# ---------------------------------
# ---------- OPTIONS --------------
# ---------------------------------
setopt no_beep
setopt auto_cd
setopt extended_glob
setopt nomatch
setopt interactive_comments

# Colors
autoload -Uz colors && colors
zle_highlight=('paste:none')
ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=244'

# ---------------------------------
# --------- COMPLETIONS -----------
# ---------------------------------
# Configure every completion directory before initializing completion. Changing
# fpath after compinit forces expensive .zcompdump rebuilds on every shell.
typeset -U fpath
completion_cache="${XDG_CACHE_HOME:-$HOME/.cache}/zsh/completions"
if [[ -n ${HOMEBREW_PREFIX:-} ]]; then
  fpath=(
    "$completion_cache"
    "$ZDOTDIR/completion"
    "$HOMEBREW_PREFIX/share/zsh/site-functions"
    "$HOMEBREW_PREFIX/share/zsh-completions"
    $fpath
  )
else
  fpath=("$completion_cache" "$ZDOTDIR/completion" $fpath)
fi
unset completion_cache

FIGNORE=DS_Store
zstyle ':completion:*' list-colors ''
zstyle ':completion:*' menu select
zstyle ":completion:*:default" list-colors ${(s.:.)LS_COLORS} "ma=48;5;153;1"
zstyle ':completion:*:*:kill:*:processes' list-colors '=(#b) #([0-9]#) ([0-9a-z-]#)*=01;34=0=01'
zstyle ':completion:*' matcher-list 'm:{a-zA-Z-_}={A-Za-z_-}' 'r:|=*' 'l:|=* r:|=*'

zmodload zsh/complist
autoload -Uz compinit
compinit
_comp_options+=(globdots)

unsetopt menu_complete
setopt auto_menu
setopt complete_in_word
setopt always_to_end

# ---------------------------------
# ------- EDIT LINE IN VIM --------
# ---------------------------------
autoload -Uz edit-command-line
zle -N edit-command-line
bindkey '^e' edit-command-line

# ---------------------------------
# ------------ UTILS --------------
# ---------------------------------
[[ ! -r "$ZDOTDIR/zsh-autocommands" ]] || source "$ZDOTDIR/zsh-autocommands"
[[ ! -r "$ZDOTDIR/zsh-herdr" ]] || source "$ZDOTDIR/zsh-herdr"
[[ ! -r "$ZDOTDIR/zsh-vim-mode" ]] || source "$ZDOTDIR/zsh-vim-mode"
[[ ! -r "$ZDOTDIR/zsh-aliases" ]] || source "$ZDOTDIR/zsh-aliases"

# Initialize Starship after custom ZLE widgets so it can preserve and wrap them.
if (( $+commands[starship] )); then
  eval "$(starship init zsh)"
fi

# ---------------------------------
# ---------- PLUGINS --------------
# ---------------------------------
if [[ -n ${HOMEBREW_PREFIX:-} ]]; then
  autosuggestions="$HOMEBREW_PREFIX/share/zsh-autosuggestions/zsh-autosuggestions.zsh"
  syntax_highlighting="$HOMEBREW_PREFIX/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
else
  autosuggestions="/usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh"
  syntax_highlighting="/usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
fi

[[ ! -r $autosuggestions ]] || source "$autosuggestions"

# Syntax highlighting must be sourced last.
[[ ! -r $syntax_highlighting ]] || source "$syntax_highlighting"
unset autosuggestions syntax_highlighting
