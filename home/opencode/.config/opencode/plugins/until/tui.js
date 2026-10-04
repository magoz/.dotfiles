// `until` TUI entry. OpenCode resolves `@opentui/solid` and `solid-js` to the host's own copies,
// so plain JS needs no JSX build. API verified against OpenCode v2.0.20 plugin/src/tui/context.ts.
import { createComponent, createElement, effect, insert, setProp } from '@opentui/solid';
import { createSignal } from 'solid-js';
import { setupUntil } from './view.js';

const runtime = { createComponent, createElement, effect, insert, setProp, createSignal };

export default { id: 'dotfiles-until', setup: (ctx) => setupUntil(ctx, runtime) };
