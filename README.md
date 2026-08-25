## macOS installation

```sh
./macos/install
./macos/install-apps # optional desktop applications
```

After the install we need to configure Copilot.  
Follow the instructions: <https://github.com/github/copilot.vim>

## Repository layout

- [`home/`](home/) — GNU Stow packages projected into the operator's home directory.
- [`macos/`](macos/) — macOS installation and Stow entry points.
- [`box/`](box/README.md) — plan, automation, and decisions for the dedicated agent host.
  - [`Framework Desktop`](box/framework-desktop/README.md) — hardware-specific assembly, firmware, compatibility, and platform notes.

## Development tooling

- [`sandbox-db` and `provision-env`](home/scripts/.local/share/sandbox-db/README.md) — provision Vercel-backed local environments and expiring Neon database branches.
- [`worktree`](home/scripts/.local/share/worktree/README.md) — create a provisioned Herdr worktree and hand off to a fresh Pi session.

## TODO

### ZSH

- [ ] customize completion colors <https://github.com/finnurtorfa/zsh/blob/master/completion.zsh/>

### Tmux

- [ ] add padding-bottom to promt, sine it's too close to the edge.
  - <https://www.reddit.com/r/tmux/comments/rascjp/comment/hnmqe69/?utm_source=share&utm_medium=web2x&context=3>

### Neovim

- [ ] Fix leader-p to paste on visual mode.
- [ ] Add [nvim-spectre](https://github.com/nvim-pack/nvim-spectre) for search and replace.
- [ ] Fix cmp randomly stopping working and having to restart nvim.
- [ ] Fix autoformat on save randomly stopping working and having to restart nvim.
- [ ] Find a way of showing unsaved buffers.
- [ ] See if we can find lsp for mdx
  - <https://github.com/mdx-js/eslint-mdx>
  - <https://github.com/mdx-js/vscode-mdx>
