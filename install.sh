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
  neovim \
  nikitabobko/tap/aerospace \
  stow \
  tmux \
  zsh \
  eza \
  zoxide \
  fzf \
  powerlevel10k \
  zsh-autosuggestions \
  zsh-syntax-highlighting \
  zsh-completions

# Borders
brew tap FelixKratz/formulae
brew install borders

# --------------------------------------
# --------------  STOW -----------------
# --------------------------------------
echo "🔗 Running Stow"
stow stow
stow nvim
stow wezterm
stow zsh
stow tmux
stow git
stow aerospace
stow borders

# --------------------------------------
# --------------  ZSH ------------------
# --------------------------------------
rm -f ~/.zcompdump
compinit # zsh-completions

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
