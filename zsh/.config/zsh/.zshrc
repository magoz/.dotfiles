# Zsh configuration directory
export ZDOTDIR="$HOME/.config/zsh"

# Instant prompt is intentionally disabled. It switches the terminal to
# noncanonical mode before ZLE is ready, which exposes early backspaces as ^?.

# ---------------------------------
# ------- EXPORTS & PATH ----------
# ---------------------------------
[[ ! -r "$ZDOTDIR/zsh-exports" ]] || source "$ZDOTDIR/zsh-exports"

# ---------------------------------
# -------- POWERLEVEL10K ----------
# ---------------------------------
if [[ -r "$HOMEBREW_PREFIX/share/powerlevel10k/powerlevel10k.zsh-theme" ]]; then
  source "$HOMEBREW_PREFIX/share/powerlevel10k/powerlevel10k.zsh-theme"
fi

# To customize the prompt, run `p10k configure` or edit this file.
[[ ! -r "$ZDOTDIR/.p10k.zsh" ]] || source "$ZDOTDIR/.p10k.zsh"

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
fpath=(
  "$ZDOTDIR/completion"
  "$HOMEBREW_PREFIX/share/zsh/site-functions"
  "$HOMEBREW_PREFIX/share/zsh-completions"
  $fpath
)

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

# ---------------------------------
# ---------- PLUGINS --------------
# ---------------------------------
[[ ! -r "$HOMEBREW_PREFIX/share/zsh-autosuggestions/zsh-autosuggestions.zsh" ]] || \
  source "$HOMEBREW_PREFIX/share/zsh-autosuggestions/zsh-autosuggestions.zsh"

# Syntax highlighting must be sourced last.
[[ ! -r "$HOMEBREW_PREFIX/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" ]] || \
  source "$HOMEBREW_PREFIX/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
