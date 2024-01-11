#!/bin/bash

# set current directory, in case the script is called from another directory.
cd "$(dirname "$0")" || exit

# Disable Brew telemetry
brew analytics off

# -------------------------------------- 
# -----------  INSTALL APPS ------------
# -------------------------------------- 
echo "🍺 Installing apps with Homebrew"
brew install \
  keyboard-maestro \
  raycast \
  amethyst \
  istat-menus \
  appcleaner \
  postico \
  medis \
  telegram \
  spotify
