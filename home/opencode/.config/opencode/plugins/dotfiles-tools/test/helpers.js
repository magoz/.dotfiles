import assert from 'node:assert/strict';

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
export function eventStream() {
  const queue = []; let wake;
  return {
    emit(event) { queue.push(event); wake?.(); },
    async *subscribe({ signal }) {
      const abort = () => wake?.(); signal.addEventListener('abort', abort);
      try {
        while (!signal.aborted) {
          if (queue.length) yield queue.shift();
          else await new Promise((resolve) => { wake = resolve; });
        }
      } finally { signal.removeEventListener('abort', abort); }
    },
  };
}
export function fixture() {
  const stream = eventStream(), tools = new Map(), toasts = [], synthetic = [], prompts = [];
  let handlers, route = { type: 'session', sessionID: root.id }, session = root, confirmations = 0;
  const server = {
    location, event: stream,
    session: {
      async get({ sessionID }) { return sessionID === root.id ? session : { ...root, id: sessionID, parentID: root.id }; },
      async synthetic(input, options) { assert.ok(options.signal); synthetic.push(input); },
    },
    rpc: { async register(definition, methods) { assert.equal(definition.id, 'dotfiles-tools'); handlers = methods; return { async dispose() {} }; } },
    tool: { async transform(edit) { edit({ add(tool) { tools.set(tool.name, tool); } }); return { async dispose() {} }; } },
  };
  const tui = {
    location,
    client: {
      rpc(definition) {
        return Object.fromEntries(Object.keys(definition.methods).map((name) => [name, async (input, options) => {
          assert.deepEqual(options.location, location); assert.ok(options.signal);
          options.signal.throwIfAborted();
          return handlers[name](input, { signal: options.signal });
        }]));
      },
      session: {
        get: server.session.get,
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
      dialog: { async confirm() { confirmations++; return true; }, async prompt() { return 'task'; } },
      toast: { show(value) { toasts.push(value); } },
    },
  };
  return {
    server, tui, tools, toasts, synthetic, prompts, stream,
    get handlers() { return handlers; }, get confirmations() { return confirmations; },
    setRoute(value) { route = value; }, setSession(value) { session = value; },
  };
}
