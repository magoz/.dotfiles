// `/quota` TUI entry. OpenCode resolves `@opentui/solid` to the host's own copy.
import { createComponent } from '@opentui/solid';
import { setupUsage } from './view.js';

export default { id: 'dotfiles-subscription-usage', setup: (ctx) => setupUsage(ctx, createComponent) };
