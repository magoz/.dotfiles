import assert from 'node:assert/strict';
import { Effect, Exit, Queue, Scope, Stream } from 'effect';
import { setup } from '../server.ts';
import { setupTui } from '../view.js';

export const location = { directory: '/repo' };
export const root = { id: 'ses_root', location, time: { created: 1, updated: 1 }, projectID: 'project' };
export const destination = {
  source: '/repo', branch: 'feat/task', base: 'abc123', path: '/worktrees/task',
  workspaceId: 'workspace', paneId: 'pane', agentName: 'task', agentKind: 'opencode', warnings: [],
};
export const request = { id: 'request', sessionID: root.id, rootID: root.id, cwd: '/repo', kind: 'worktree', input: { branch: 'feat/task' } };
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const flush = () => new Promise((resolve) => setImmediate(resolve));
export async function waitFor(predicate, limit = 100) {
  for (let i = 0; i < limit; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.fail('Timed out waiting for test state');
}
/** Runs the Effect server in its own scope; `stop` closes it like a plugin unload. */
export async function startServer(f) {
  const scope = Effect.runSync(Scope.make());
  const api = await Effect.runPromise(setup(f.server).pipe(Scope.provide(scope)));
  return { api, stop: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}
/** Calls the registered tool like the host: its Effect, failing with the sanitized Tool.Error. */
export const callTool = (f, input, sessionID = root.id) => Effect.runPromise(f.tools.get('create_worktree').execute(input, { sessionID }));
/** The TUI half with the host's Solid runtime replaced by a direct call. */
export const startTui = (f, options) => setupTui(f.tui, (component, props) => component(props), options);

export function fixture() {
  const events = Effect.runSync(Queue.unbounded()), tools = new Map(), toasts = [], prompts = [];
  let handlers, route = { type: 'session', sessionID: root.id }, session = root, confirmations = 0;
  const server = {
    location,
    session: {
      get: ({ sessionID }) => Effect.succeed(sessionID === root.id ? session : { ...root, id: sessionID, parentID: root.id }),
    },
    event: { subscribe: () => Stream.fromQueue(events) },
    rpc: {
      register: (definition, methods) => Effect.sync(() => {
        assert.equal(definition.id, 'dotfiles-tools'); handlers = methods;
        return { dispose: Effect.void, events: { emit: () => Effect.void } };
      }),
    },
    tool: { transform: (edit) => Effect.sync(() => edit({ add(tool) { tools.set(tool.name, tool); } })) },
  };
  const tui = {
    location,
    client: {
      rpc(definition) {
        return Object.fromEntries(Object.keys(definition.methods).map((name) => [name, async (input, options) => {
          assert.deepEqual(options.location, location); assert.ok(options.signal);
          options.signal.throwIfAborted();
          // The host runs the server handler and interrupts it when the caller aborts.
          return Effect.runPromise(handlers[name](input, {}), { signal: options.signal });
        }]));
      },
      session: {
        get: async ({ sessionID }) => (sessionID === root.id ? session : { ...root, id: sessionID, parentID: root.id }),
        async active() { return {}; },
        async list() { return { data: [], cursor: {} }; },
        async prompt(input) { prompts.push(input); },
      },
    },
    data: { session: {
      get() { return session; }, status() { return 'idle'; },
      permission: { invalidate() {}, async sync() {}, list() { return []; } },
      form: { invalidate() {}, async sync() {}, list() { return []; } },
      pending: { invalidate() {}, async sync() {}, list() { return []; } },
    } },
    keymap: { layer(layer) { tui.commands = layer().commands; }, dispatch() { assert.fail('No automatic exit allowed'); } },
    ui: {
      router: { current() { return route; } },
      // The keymap layer must be created while the `app` slot renders, never in setup.
      slot(claim) { assert.equal(claim.append, 'app'); claim.render(); return () => {}; },
      dialog: { async confirm() { confirmations++; return true; }, async prompt() { return 'task'; } },
      toast: { show(value) { toasts.push(value); } },
    },
  };
  return {
    server, tui, tools, toasts, prompts,
    emit(event) { Queue.offerUnsafe(events, event); },
    get handlers() { return handlers; }, get confirmations() { return confirmations; },
    setRoute(value) { route = value; }, setSession(value) { session = value; },
  };
}
