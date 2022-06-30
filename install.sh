#!/bin/bash

# set current directory, in case the script is called from another directory.
cd "$(dirname "$0")" || exit

# -------------------------------------- 
# ------ CLEANUP EXISTING CONF ---------
# -------------------------------------- 
rm -rf tmux/.config/tmux/plugins
rm ~/.gitconfig

# -------------------------------------- 
# ---------  INSTALL PACKAGES ----------
# -------------------------------------- 
echo "🍺 Installing packages with Homebrew"
brew install \
  bat \
  git \
  iterm2 \
  neovim \
  stow \
  tmux \
  zsh

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
# -------------  NEOVIM ----------------
# -------------------------------------- 
# Plugins dependencies
# # used by hexokinase uses go
brew install \
  go \
  lazygit 

# LSP
npm i -g bash-language-server # bash
npm i -g yaml-language-server # yamlls
npm i -g vscode-langservers-extracted # cssls
npm i -g cssmodules-language-server # cssmodules_ls
brew install lua-language-server  # sumneko_lua

# Formatters & Linters (diagnostics)
brew install \
  eslint \
  prettier \
  stylua

# -------------------------------------- 
# -------------  ITERM2 ----------------
# -------------------------------------- 
echo "✨ Install Hack Nerd font for symbols"
brew tap homebrew/cask-fonts
brew install --cask font-hack-nerd-font

echo "🤖 Installing Iterm2 config"
# Specify the preferences directory
defaults write com.googlecode.iterm2.plist PrefsCustomFolder -string "$HOME/.config/iterm2/profile"

# Tell iTerm2 to use the custom preferences in the directory
defaults write com.googlecode.iterm2.plist LoadPrefsFromCustomFolder -bool true

# -------------------------------------- 
# ------------- TMUX ----------------
# -------------------------------------- 
tmux source "$HOME/.config/tmux/tmux.conf"
echo "✅ Sourced Tmux"

