alias vim='nvim'
alias vi='nvim'

# Enable VIM mode
bindkey -v

export ZSH=/Users/magoz/.oh-my-zsh
ZSH_CUSTOM=$HOME/.config/oh-my-zsh/custom

ZSH_THEME="hyperzsh"

plugins=(
  git
  macos
)

source $ZSH/oh-my-zsh.sh

zstyle ':omz:update' mode auto

cd ~/dev/core-projects


# nnn
export NNN_PLUG='v:imgview'

# --------------------------------
#           PLUGINS 
# --------------------------------

# ----- Autosuggest -----
ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=244'


# --------------------------------
#           FUNCTIONS
# --------------------------------

# ls after cd
# https://stackoverflow.com/questions/3964068/zsh-automatically-run-ls-after-every-cd
function chpwd() {
    emulate -L zsh
    ls -a
}

# --------------------------------
#            ON LOAD
# --------------------------------

# Start / attach a new tmux session on launch
if [ -z "$TMUX" ]
then
    tmux attach -t TMUX || tmux new -s TMUX
fi

# --------------------------------
#             ALIAS
# --------------------------------

# Quicklook
alias ql='function _qlfunc(){ qlmanage -p $@ >/dev/null 2>&1 &};_qlfunc'

# -------------------------------
#         ANDROID STUDIO
# -------------------------------

export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools

# -------------------------------
#         HOME BREW PLUGINS
# -------------------------------
source $(brew --prefix)/share/zsh-autosuggestions/zsh-autosuggestions.zsh
source $(brew --prefix)/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

