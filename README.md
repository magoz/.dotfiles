# Dotfiles

Personal development environment shared across macOS and Arch Linux machines.

Configuration installed into a user home directory lives in GNU Stow packages under [`home/`](home/). Platform setup stays outside that tree: [`macos/`](macos/) and [`arch/`](arch/) install user environments, while the dedicated Box agent host is installed and operated from a separate private infrastructure repository.

## Repository layout

```text
.
├── home/                  GNU Stow packages projected into $HOME
├── arch/                  Arch Linux user configuration and dependencies
│   ├── install
│   ├── stow
│   └── tests/
└── macos/                 macOS installation and package selection
    ├── install
    ├── install-apps
    ├── stow
    └── tests/
```

The directories under `home/` mirror their destination beneath `$HOME`. For example:

```text
home/nvim/.config/nvim/       → ~/.config/nvim/
home/pi/.pi/                  → ~/.pi/
home/scripts/.local/bin/      → ~/.local/bin/
```

Package groups include:

- Agent tooling: `agents`, `herdr`, `opencode`, and `pi`
- Development tools: `git`, `lazygit`, `nvim`, and `scripts`
- Shell and terminals: `ghostty`, `starship`, and `zsh`
- Browser customization: `vimium`
- macOS UI: `aerospace`, `borders`, and `leaderkey`
- Stow configuration: `stow`

Not every target installs every package. [`macos/stow`](macos/stow) and [`arch/stow`](arch/stow) define their platform selections; machine-role installers may select additional packages.

## macOS

### Prerequisites

- macOS
- Homebrew
- Git access to this repository

Clone into the expected location:

```sh
git clone git@github.com:magoz/.dotfiles.git ~/.dotfiles
cd ~/.dotfiles
```

Run the workstation installer:

```sh
./macos/install
```

It installs command-line dependencies with Homebrew, installs Pi and OpenCode, applies the macOS Stow packages, installs package dependencies, and refreshes configured services and plugins. It removes existing `~/.gitconfig` and `~/.zprofile` before Stow takes ownership, so inspect the script before using it on a new machine.

Install the optional desktop application set separately:

```sh
./macos/install-apps
```

To apply only the tracked home configuration without installing software:

```sh
./macos/stow
```

The Stow command is safe to rerun. It also migrates symlinks created by the previous root-level package layout to `home/` while leaving unrelated symlinks untouched.

## Arch Linux (including Omarchy)

### Prerequisites

On an already installed Arch system, install the development dependencies separately:

```sh
sudo pacman -Syu --needed base-devel bat bun curl eza fd fzf git github-cli jq \
  lazygit neovim nodejs-lts-krypton npm pnpm ripgrep starship stow tealdeer \
  zoxide zsh zsh-autosuggestions zsh-syntax-highlighting
```

This is an explicit system upgrade: review Arch upgrade notices first. The configured agent packages require Node **>=24.18 and <25**, supplied by `nodejs-lts-krypton`, rather than the current `nodejs` package. Herdr is optional and installed separately; its machine-specific configuration is not applied by the generic Arch installer.

Clone the repository if needed, then install as your normal user:

```sh
git clone git@github.com:magoz/.dotfiles.git ~/.dotfiles
cd ~/.dotfiles
./arch/install
```

For routine updates:

```sh
cd ~/.dotfiles
git pull
./arch/install
```

The installer applies shell, Starship, Neovim, LazyGit, agents, and scripts; installs user-local npm 11.16.0, Pi, OpenCode 2 beta, and package/plugin dependencies; and refreshes completions. It sets portable Git workflow defaults and the tracked ignore file while preserving your existing Git identity and credential helpers. It does not install the macOS Git configuration.

To apply configuration only (no dependency installation or Git changes):

```sh
./arch/stow
```

Neither command changes the login shell, runs system provisioning, manages services, or touches Hyprland, Ghostty, or other desktop configuration. Omarchy retains ownership of its desktop. Existing conflicting files or unrelated symlinks are reported rather than overwritten; review and back up any configuration you explicitly want to replace before rerunning. Known links from the old root-level package layout are migrated automatically.

Start the configured shell with `exec zsh -l`. Selecting Zsh as your default login shell is a separate, deliberate choice.

## Box agent host

The dedicated Box host keeps its destructive bootstrap, hardware configuration, services, security checks, audits, and recovery runbooks in the separate private `magoz/box` repository. That repository treats `~/.dotfiles/home` as an external package catalog and applies the Linux-safe subset without owning or duplicating these user configurations.

For the portable user environment, use `~/.dotfiles/arch/install`. For the complete Box-specific dotfiles selection and login-shell setup, use `~/.box/install`. Neither is destructive system provisioning. Never run the macOS installer on Box.

## Working with Stow packages

Preview one package without changing `$HOME`:

```sh
stow --dir "$PWD/home" --target "$HOME" --simulate --restow nvim
```

Apply or remove one package manually:

```sh
stow --dir "$PWD/home" --target "$HOME" --restow nvim
stow --dir "$PWD/home" --target "$HOME" --delete nvim
```

To add a package:

1. Create `home/<package>/` using the same paths the files should have beneath `$HOME`.
2. Add the package to `macos/stow`, `arch/stow`, and/or the appropriate machine-role installer.
3. Run a Stow simulation before applying it.
4. Keep credentials and runtime state out of the tracked package.

Most edits take effect immediately because the destination is a symlink into this repository. Rerun Stow when adding, removing, or relocating files.

## Included development commands

The `home/scripts` package installs command launchers and their source under `~/.local`:

- [`sandbox-db` and `provision-env`](home/scripts/.local/share/sandbox-db/README.md) manage Vercel-backed environments and expiring Neon database branches.
- [`worktree`](home/scripts/.local/share/worktree/README.md) creates provisioned Herdr worktrees and hands off to fresh Pi sessions.

## Validation

Run the focused repository checks after changing installation or Stow behavior:

```sh
./macos/tests/run
./arch/tests/run
git diff --check
```

The platform tests use temporary home directories to verify legacy-link migration and preservation of unrelated configuration. Arch tests also cover desktop/runtime preservation, conflict preflight, Linux Zsh startup, and a mocked dependency installation on an unprivileged Arch host. Machine-role repositories test their own integration with this package catalog independently.

## Local and sensitive state

Do not commit credentials, private keys, auth files, machine-local installer values, or runtime sessions.

- Pi, OpenCode, Herdr, package-manager, and browser runtime state is excluded through `.gitignore` or package-local Stow ignore rules.
- SSH private keys and machine-local infrastructure configuration are never stored in this repository or copied between machines.
