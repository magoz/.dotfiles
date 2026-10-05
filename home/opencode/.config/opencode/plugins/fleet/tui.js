// Fleet terminal view (auto-discovered CLI plugin). OpenCode's runtime plugin support resolves
// `@opentui/solid` and `solid-js` to the host's own copies, so plain JS needs no JSX build.
// API verified against OpenCode v2.0.22 packages/plugin/src/tui/context.ts.
import { createComponent, createElement, effect, insert, setProp, useTerminalDimensions } from '@opentui/solid';
import { createSignal } from 'solid-js';
import { setupFleet } from './view.js';

const runtime = { createComponent, createElement, effect, insert, setProp, useTerminalDimensions, createSignal };

export default { id: 'dotfiles.fleet', setup: (ctx) => setupFleet(ctx, runtime) };
