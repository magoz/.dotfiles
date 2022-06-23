#!/bin/bash
cd "$(dirname "$0")"

# -------------------------------------- 
# ---------  INSTALL PACKAGES ----------
# -------------------------------------- 

echo "🍺 Installing packages with Homebrew"
brew install \
  bat \
  neovim \
  stow \
  zsh \

# -------------------------------------- 
# ------------ OH MY ZSH ---------------
# -------------------------------------- 

rm -rf ~/.zshrc
rm -rf ~/.oh-my-zsh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
rm -rf ~/.zshrc

# -------------------------------------- 
# --------------- ZSH ------------------
# -------------------------------------- 
echo "✨ Installing zsh plugins"
brew install \
  zsh-autosuggestions \
  zsh-syntax-highlighting


# -------------------------------------- 
# --------------  STOW -----------------
# -------------------------------------- 

echo "🔗 Running Stow"
stow nvim
stow zsh
stow oh-my-zsh
stow tmux
stow git

# -------------------------------------- 
# -----------  VIM PLUG ----------------
# -------------------------------------- 

echo "🔌 Installing vim-plug"
sh -c 'curl -fLo "${XDG_DATA_HOME:-$HOME/.local/share}"/nvim/site/autoload/plug.vim --create-dirs \
       https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'


# -------------------------------------- 
# -------------  ITERM2 ----------------
# -------------------------------------- 

echo "🪄 Installing vim-plug"
# Specify the preferences directory
defaults write com.googlecode.iterm2.plist PrefsCustomFolder -string "~/.dotfiles/iterm2"

# Tell iTerm2 to use the custom preferences in the directory
defaults write com.googlecode.iterm2.plist LoadPrefsFromCustomFolder -bool true


