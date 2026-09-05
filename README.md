# Dotfiles

Personal development environment shared across macOS and Arch Linux machines.

Configuration installed into a user home directory lives in GNU Stow packages under [`home/`](home/). Platform setup stays outside that tree: [`macos/`](macos/) provisions client machines, while the dedicated Box agent host is installed and operated from a separate private infrastructure repository.

## Repository layout

```text
.
├── home/                  GNU Stow packages projected into $HOME
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

Not every target installs every package. [`macos/stow`](macos/stow) defines the macOS selection; machine-role installers select their own compatible subset from this package catalog.

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

## Box agent host

The dedicated Box host keeps its destructive bootstrap, hardware configuration, services, security checks, audits, and recovery runbooks in the separate private `magoz/box` repository. That repository treats `~/.dotfiles/home` as an external package catalog and applies the Linux-safe subset without owning or duplicating these user configurations.

Never run the macOS installer on Box.

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
2. Add the package to `macos/stow` and/or the appropriate machine-role installer.
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
git diff --check
```

The macOS test uses temporary home directories. It verifies both migration of legacy Stow links and preservation of unrelated links. Machine-role repositories test their own integration with this package catalog independently.

## Local and sensitive state

Do not commit credentials, private keys, auth files, machine-local installer values, or runtime sessions.

- Pi, OpenCode, Herdr, package-manager, and browser runtime state is excluded through `.gitignore` or package-local Stow ignore rules.
- SSH private keys and machine-local infrastructure configuration are never stored in this repository or copied between machines.
