#!/bin/bash
cd "$(dirname "$0")"

# -------------------------------------- 
# ---------  INSTALL PACKAGES ----------
# -------------------------------------- 

echo "🍺 Installing packages with Homebrew"
brew install \
  bat \
  iterm2 \
  neovim \
  stow \
  zsh \


# -------------------------------------- 
# --------------  STOW -----------------
# -------------------------------------- 

echo "🔗 Running Stow"
stow stow
stow nvim
stow iterm2 
stow zsh
stow tmux
stow git

# -------------------------------------- 
# -------------  ITERM2 ----------------
# -------------------------------------- 

echo "✨ Install Hack Nerd font for symbols"
brew tap homebrew/cask-fonts
brew install --cask font-hack-nerd-font

echo "🤖 Installing Iterm2 config"
# Specify the preferences directory
defaults write com.googlecode.iterm2.plist PrefsCustomFolder -string "~/.config/iterm2/profile"

# Tell iTerm2 to use the custom preferences in the directory
defaults write com.googlecode.iterm2.plist LoadPrefsFromCustomFolder -bool true


