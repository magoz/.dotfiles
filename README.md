# Dotfiles

Personal development environment for macOS clients and the dedicated Arch Linux agent host named `box`.

Configuration installed into a user home directory lives in GNU Stow packages under [`home/`](home/). Platform setup stays outside that tree: [`macos/`](macos/) provisions client machines, while [`box/`](box/README.md) installs and operates the remote agent host.

## Repository layout

```text
.
├── home/                  GNU Stow packages projected into $HOME
├── macos/                 macOS installation and package selection
│   ├── install
│   ├── install-apps
│   ├── stow
│   └── tests/
└── box/                   Arch agent-host installation and operations
    ├── bootstrap
    ├── install
    ├── provision
    ├── verify
    └── framework-desktop/
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

Not every target installs every package. [`macos/stow`](macos/stow) defines the macOS selection; [`box/provision`](box/provision) defines the smaller Linux-safe selection.

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

`box` is a dedicated remote machine for Herdr, coding agents, repositories, worktrees, builds, and private browser automation. It is not configured as a graphical workstation.

Start with the detailed [Box runbook](box/README.md) and the [Framework Desktop platform notes](box/framework-desktop/README.md). The main entry points are:

```sh
cp box/config.example box/config.local
sudo ./box/bootstrap --config box/config.local --preflight
sudo ./box/bootstrap --config box/config.local --destroy-disk '<exact-serial>'

./box/provision
./box/verify
```

`box/bootstrap` is destructive and must only be run from the official Arch live ISO after reviewing the disk identity and read-only preflight. After the Box package phase has installed required system tools, `box/install` applies the Linux-safe dotfiles and package-local dependencies, including the portable Zsh and Starship configuration, generates completions for supported agent tools, and makes Zsh the operator's login shell. Full Box setup uses the safe, rerunnable `box/provision` command. Never run the macOS installer on the Box.

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
2. Add the package to `macos/stow`, `box/provision`, or both.
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
./box/tests/run
git diff --check
```

The macOS test uses temporary home directories. It verifies both migration of legacy Stow links and preservation of unrelated links. The Box suite is non-destructive and covers configuration parsing, shell syntax, platform guards, storage path helpers, and Stow integration.

## Local and sensitive state

Do not commit credentials, private keys, auth files, machine-local installer values, or runtime sessions.

- `box/config.local` is ignored and contains the real machine and disk values.
- Pi, OpenCode, Herdr, package-manager, and browser runtime state is excluded through `.gitignore` or package-local Stow ignore rules.
- SSH private keys are never stored in this repository or copied between machines; Box bootstrap receives only a public-key file path, and GitHub authentication generates a separately revocable key directly on Box.
