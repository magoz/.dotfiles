#!/bin/sh

# based on
# https://github.com/Mach-OS/Machfiles/blob/6373a1fd1e42ca2fd8babd95ef4acce9164c86c3/zsh/.config/zsh/.zshrc
# https://www.youtube.com/watch?v=bTLYiNvRIVI

# Set zsh direcory
export ZDOTDIR=$HOME/.config/zsh

# Brew path
export PATH="/opt/homebrew/bin:$PATH"

# ---------------------------------
# ---------- OPTIONS --------------
# ---------------------------------
# More: https://linux.die.net/man/1/zshoptions 

# General 
setopt no_beep                             # Prevent making sounds on erros
setopt auto_cd                             # If a command is issued that can't be executed as a normal command, perform the cd command to that directory. 
setopt extended_glob                       # Treat the '#', '~' and '^' characters as part of patterns for filename generation.
setopt nomatch                             # If a pattern for filename generation has no matches, print an error.
setopt menu_complete                       # On an ambiguous completion, instead of listing possibilities or beeping, insert the first match immediately.
setopt interactive_comments                # Allow comments even in interactive shells.

# History
export HISTFILE=ZDOTDIR/.zsh_history       # History file
export HISTFILESIZE=1000000000             # History file size
export SAVEHIST=500000                     # Number of commands that are stored in the zsh history file
export HISTSIZE=500000                     # Number of commands that are loaded into memory from the history file
setopt append_history                      # zsh sessions will append their history list to the history file, rather than replace it.
setopt inc_append_history                  # Ensure that commands are added to the history immediately
setopt extended_history                    # Records the timestamp of each command in HISTFILE
setopt hist_find_no_dups                   # Up and down arrows skip duplicates and show each command only once with (duplicate commands are still written to the history)
setopt hist_ignore_space                   # ignore commands that start with space
setopt hist_verify                         # show command with history expansion to user before running it
setopt share_history                       # share command history data

# Colors 
autoload -Uz colors && colors              # color support
stty stop undef		                         # Disable ctrl-s to freeze terminal.
zle_highlight=('paste:none')               # Stop pasted text being highlighted.

# ---------------------------------
# --------- COMPLETIONS -----------
# ---------------------------------
# Homebrew completions
# See: https://docs.brew.sh/Shell-Completion#configuring-completions-in-zsh
if type brew &>/dev/null
then
  FPATH="$(brew --prefix)/share/zsh/site-functions:${FPATH}"

  autoload -Uz compinit
  # compinit # We call it later
fi

# Remove inferior completions that the git package provide.
# That will force zsh to use it's own completion for git that is much better. More info:
# https://github.com/Homebrew/homebrew-core/pull/59062#issuecomment-1084908889
rm -f "$(brew --prefix)/share/zsh/site-functions/_git"

FIGNORE=DS_Store # List of files to ignore in completion

# Completions colors
# https://github.com/finnurtorfa/zsh/blob/master/completion.zsh
zstyle ':completion:*' list-colors '' # Color completions
zstyle ':completion:*' menu select # Enable selected completion
zstyle ":completion:*:default" list-colors ${(s.:.)LS_COLORS} "ma=48;5;153;1" # Color selected completion
zstyle ':completion:*:*:kill:*:processes' list-colors '=(#b) #([0-9]#) ([0-9a-z-]#)*=01;34=0=01'

# Enable completions
zmodload zsh/complist
autoload -U compinit; compinit
_comp_options+=(globdots) # Include hidden files

# case insensitive (all), partial-word and substring completion
# https://github.com/ohmyzsh/ohmyzsh/blob/master/lib/completion.zsh
zstyle ':completion:*' matcher-list 'm:{a-zA-Z-_}={A-Za-z_-}' 'r:|=*' 'l:|=* r:|=*'

# Completion settings
unsetopt menu_complete                     # Do not autoselect the first completion entry
setopt auto_menu                           # Show completion menu on successive tab press
setopt complete_in_word                    # Cursor stays where it is and completion is done from both ends.
setopt always_to_end                       # If a completion is performed with the cursor within a word, and a full completion is inserted, the cursor is moved to the end of the word

# ---------------------------------
# ------- EDIT LINE IN VIM --------
# ---------------------------------
autoload edit-command-line; zle -N edit-command-line
bindkey '^e' edit-command-line # use `ctrl + e` to edit current line in vim

# ---------------------------------
# ----- LOCAL FILES & UTILS -------
# ---------------------------------
source "$ZDOTDIR/zsh-functions"
zsh_add_file "zsh-autocommands"
zsh_add_file "zsh-exports"
zsh_add_file "zsh-vim-mode"
zsh_add_file "zsh-aliases"
zsh_add_file "zsh-prompt"

# ---------------------------------
# ----------- PLUGINS -------------
# ---------------------------------
# For more plugins: https://github.com/unixorn/awesome-zsh-plugins
zsh_add_plugin "zsh-users/zsh-autosuggestions"
zsh_add_plugin "zsh-users/zsh-syntax-highlighting"
zsh_add_file "zsh-users/zsh-completions"
zsh_add_plugin "hlissner/zsh-autopair"
zsh_add_plugin "sindresorhus/pure"

#zsh-autosuggestions color
ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=244'


# pnpm
export PNPM_HOME="/Users/magoz/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end
