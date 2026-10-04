// `create_worktree` TUI entry. OpenCode resolves `@opentui/solid` to the host's own copy.
import { createComponent } from '@opentui/solid';
import { setupTui } from './view.js';

export default { id: 'dotfiles-tools', setup: (ctx) => setupTui(ctx, createComponent) };
