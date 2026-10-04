// `until` server plugin: the agent tool, the TUI RPC, and session-event wiring for one location.
// No confirmation dialog: like pi-until, the tool is gated only by the agent's `shell` permission.
import path from 'node:path';
import { createCheckRunner } from './check.js';
import {
  FIRST_CHECK_WAIT_MS, TOOL_DESCRIPTION, listText, parseCommand, receipt, receiptText, startedText, toolInput,
} from './domain.js';
import { Watches } from './engine.js';
import { definition, view } from './rpc.js';
import { createTelemetry, readTelemetry, summarize, summaryText, telemetryOptions } from './telemetry.js';

const MAX_FAMILY_DEPTH = 32;
const message = (error) => (error instanceof Error ? error.message : String(error));

function checkedSession(ctx, session, sessionID) {
  if (session?.id !== sessionID || !session.location || !path.isAbsolute(session.location.directory)) throw new Error('Invalid session location');
  if (session.location.directory !== ctx.location.directory || (session.location.workspaceID ?? undefined) !== (ctx.location.workspaceID ?? undefined)) {
    throw new Error('Session does not belong to this plugin location');
  }
  return session;
}

/**
 * Who owns watches armed from `sessionID`. A subagent's turn ends and OpenCode reports its result
 * to the parent once, so a later wake of the subagent would run unseen. Watches therefore belong
 * to the family root, which is woken; `origin` records the subagent that armed them.
 * Returns `{ rootID, cwd, origin? }`; `cwd` is the calling session's directory.
 */
export async function sessionScope(ctx, sessionID) {
  const session = checkedSession(ctx, await ctx.session.get({ sessionID }), sessionID);
  const cwd = path.resolve(session.location.directory, typeof session.subpath === 'string' ? session.subpath : '.');
  const relative = path.relative(session.location.directory, cwd);
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('Session subpath escapes its location');
  let root = session;
  for (let depth = 0; root.parentID; depth++) {
    if (depth >= MAX_FAMILY_DEPTH) throw new Error('Session family is too deep');
    root = checkedSession(ctx, await ctx.session.get({ sessionID: root.parentID }), root.parentID);
  }
  if (root.id === sessionID) return { rootID: root.id, cwd };
  return { rootID: root.id, cwd, origin: { sessionID, ...(typeof session.title === 'string' && session.title ? { title: session.title.slice(0, 120) } : {}) } };
}

function inlineText(watch) {
  const r = receipt(watch);
  const lead = {
    succeeded: `Condition is already true (check ${watch.facts.attempts}, exit 0). No watch remains: continue now.`,
    timedOut: 'The watch reached timeoutSeconds before the condition became true. No watch remains.',
    failed: `The condition could not run${watch.facts.failure ? `: ${watch.facts.failure}` : ''}. No watch remains; fix it and start again.`,
  }[watch.facts.status] ?? `The watch ended: ${watch.facts.status}.`;
  return `${lead}\n\n${receiptText(r)}`;
}

function firstCheckText(watch) {
  const last = watch.facts.lastResult;
  if (!last) return '';
  return ` First check: ${last.killed ? `ran past ${watch.definition.gate.checkTimeoutMs / 1000}s (counted as false)` : `exit ${last.code}`}.`;
}

export async function setupServer(ctx, deps = {}) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const runner = deps.run ? { run: deps.run, drain: async () => [] } : createCheckRunner({ env });
  const telemetry = deps.telemetry ?? createTelemetry({ ...telemetryOptions(env), now });
  let registration;
  const watches = new Watches({
    location: { directory: ctx.location.directory, ...(ctx.location.workspaceID ? { workspaceID: ctx.location.workspaceID } : {}) },
    run: runner.run,
    synthetic: (input) => ctx.session.synthetic(input, { signal: AbortSignal.timeout(10000) }),
    waitIdle: (sessionID, signal) => ctx.session.wait({ sessionID }, { signal }),
    sessionExists: async (sessionID) => {
      try { await ctx.session.get({ sessionID }); return true; } catch (error) { return /not.?found/i.test(message(error)) ? false : undefined; }
    },
    storage: ctx.storage, telemetry, now, timers: deps.timers,
    emit: (name, data) => { void registration?.events.emit(name, data)?.catch?.(() => {}); },
  });
  const lifetime = new AbortController();
  // Saved watches load in the background; a storage failure is retried, then reported in replies.
  let loadWarning;
  const ready = (async () => {
    for (const delay of [0, 1000, 5000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (lifetime.signal.aborted) return;
      try { await watches.restore(); loadWarning = undefined; return; } catch (error) { loadWarning = message(error); }
    }
  })();
  const warn = (text) => (loadWarning ? `${text}\n\nWarning: saved until watches could not be loaded (${loadWarning}); earlier watches may not be running.` : text);
  const action = (sessionID, name, source) => telemetry.record(sessionID, { event: 'action', action: name, source });

  // Esc does not stop watches (pi parity): only deletion forgets them. Inbox and execution events
  // settle recurring wakes. A dropped stream is resubscribed, then in-flight wakes resync.
  const events = (async () => {
    let backoff = 1000;
    while (!lifetime.signal.aborted) {
      try {
        for await (const event of ctx.event.subscribe({ signal: lifetime.signal })) {
          backoff = 1000;
          try { watches.handleEvent(event); } catch { /* one bad event never stops the stream */ }
        }
      } catch { /* resubscribe below */ }
      if (lifetime.signal.aborted) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, backoff);
        lifetime.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      backoff = Math.min(backoff * 2, 30000);
      watches.resync();
    }
  })();

  const execute = async (input, tool) => {
    await ready;
    const { rootID: sessionID, cwd, origin } = await sessionScope(ctx, tool.sessionID);
    const command = parseCommand(input, { cwd, now: now(), isDirectory: deps.isDirectory });
    action(sessionID, command.action, 'tool');
    const reply = (text, watch) => ({ content: warn(text), ...(watch ? { metadata: { until: receipt(watch) } } : {}) });
    switch (command.action) {
      case 'start': {
        const started = watches.start(sessionID, command.definition, { inline: true, origin });
        const { watch, answered } = await watches.settleInline(sessionID, started.id, FIRST_CHECK_WAIT_MS, tool.signal);
        return reply(answered ? inlineText(watch) : `${startedText(watch)}${firstCheckText(watch)}`, watch);
      }
      case 'repeat': {
        const watch = watches.start(sessionID, command.definition, { origin });
        return reply(startedText(watch), watch);
      }
      case 'list':
        return reply(listText(watches.list(sessionID).map((w) => receipt(w))));
      case 'status': {
        const { watch } = watches.get(sessionID, command.id);
        return reply(receiptText(receipt(watch)), watch);
      }
      case 'cancel': {
        const watch = watches.cancel(sessionID, command.id);
        return reply(receiptText(receipt(watch)), watch);
      }
      case 'complete': {
        const watch = watches.complete(sessionID, command.id);
        return reply(receiptText(receipt(watch)), watch);
      }
      default:
        throw new Error(`Unknown until action: ${command.action}`);
    }
  };

  const attempt = async (fn) => { try { return await fn(); } catch (error) { return { error: message(error).slice(0, 2000) }; } };
  const cleanup = async () => {
    lifetime.abort();
    await watches.dispose();
    await runner.drain();
    await telemetry.flush?.();
    await registration?.dispose();
    await tools?.dispose();
    await events;
  };
  let tools;
  try {
    registration = await ctx.rpc.register(definition, {
      list: async ({ sessionID }) => {
        await ready;
        const { rootID } = await sessionScope(ctx, sessionID);
        return { watches: watches.list(rootID).map((w) => view(w, watches.phase(rootID, w.id))) };
      },
      start: async ({ sessionID, condition }) => attempt(async () => {
        await ready;
        const { rootID, cwd, origin } = await sessionScope(ctx, sessionID);
        const command = parseCommand({ action: 'start', condition }, { cwd, now: now(), isDirectory: deps.isDirectory });
        action(rootID, 'start', 'command');
        const watch = watches.start(rootID, command.definition, { origin });
        return { id: watch.id, label: watch.definition.label, status: watch.facts.status };
      }),
      cancel: async ({ sessionID, id }) => attempt(async () => {
        await ready;
        const { rootID } = await sessionScope(ctx, sessionID);
        action(rootID, 'cancel', 'command');
        return { id, status: watches.cancel(rootID, id).facts.status };
      }),
      complete: async ({ sessionID, id }) => attempt(async () => {
        await ready;
        const { rootID } = await sessionScope(ctx, sessionID);
        action(rootID, 'complete', 'command');
        return { id, status: watches.complete(rootID, id).facts.status };
      }),
      status: async ({ sessionID, id }) => attempt(async () => {
        await ready;
        const { rootID } = await sessionScope(ctx, sessionID);
        return { id, text: receiptText(receipt(watches.get(rootID, id).watch)) };
      }),
      stats: async () => attempt(async () => {
        if (!telemetry.enabled) return { text: 'until telemetry is disabled (OPENCODE_UNTIL_TELEMETRY=0).' };
        await telemetry.flush?.();
        return { text: summaryText(summarize(await readTelemetry(telemetry.filePath)), telemetry.filePath) };
      }),
    });
    tools = await ctx.tool.transform((editor) => {
      editor.add({
        name: 'until', description: TOOL_DESCRIPTION, input: toolInput,
        // Direct tool, hidden wherever the agent's `shell` permission is wholly denied.
        options: { codemode: false, permission: 'shell' },
        execute,
      });
    });
  } catch (error) { await cleanup(); throw error; }
  return cleanup;
}

export default { id: 'dotfiles-until', setup: (ctx) => setupServer(ctx) };
