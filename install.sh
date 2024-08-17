#!/bin/bash

# set current directory, in case the script is called from another directory.
cd "$(dirname "$0")" || exit

# --------------------------------------
# ------ CLEANUP EXISTING CONF ---------
# --------------------------------------
rm -rf tmux/.config/tmux/plugins
rm ~/.gitconfig
rm ~/.zprofile

# --------------------------------------
# ---------  INSTALL PACKAGES ----------
# --------------------------------------
echo "🍺 Installing basic config packages with Homebrew"
brew install \
	bat \
	git \
	node \
  wezterm \
  font-meslo-lg-nerd-font \
	iterm2 \
	neovim \
  nikitabobko/tap/aerospace \
	stow \
	tmux \
	zsh \
	fzf

# Borders
brew tap FelixKratz/formulae
brew install borders

# --------------------------------------
# --------------  STOW -----------------
# --------------------------------------
echo "🔗 Running Stow"
stow stow
stow nvim
stow iterm2
stow wezterm
stow zsh
stow tmux
stow git
stow aerospace
stow borders

# --------------------------------------
# -------------  NEOVIM ----------------
# --------------------------------------
# Plugins dependencies
# telescope uses fd and ripgrep

echo "⚡ Setting up Neovim"
brew install \
	fd \
	lazygit \
	ripgrep

# Install plugins
nvim --headless "+Lazy! sync" +qa

# --------------------------------------
# ------------- BORDERS ----------------
# --------------------------------------
brew services restart borders

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

# Enable support for italic text
tic iterm2/.config/iterm2/xterm-256color-italic.terminfo

# --------------------------------------
# ------------- TMUX ----------------
# --------------------------------------
tmux source "$HOME/.config/tmux/tmux.conf"
echo "✅ Sourced Tmux"

# --------------------------------------
# ------  INSTALL DEV PACKAGES ---------
# --------------------------------------
# tlrc is tldr
echo "🚀 Installing DEV packages with Homebrew"
brew install \
	pnpm \
	tlrc
