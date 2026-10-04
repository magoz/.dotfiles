// Pure `until` domain: tool contract, parsing at the boundary, cadence math, receipts and the
// agent-facing wake packets. Mirrors pi-until (joelhooks/pi-until@e2eceb0) semantics.
import { createHash, randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_INTERVAL_SECONDS = 30;
export const DEFAULT_CHECK_TIMEOUT_SECONDS = 30;
export const MAX_ACTIVE_PER_SESSION = 32;
export const MAX_FINISHED_PER_SESSION = 50;
/** `start` waits this long for the first check, so an already-true condition answers inline. */
export const FIRST_CHECK_WAIT_MS = 3000;

export const ACTIONS = ['start', 'repeat', 'list', 'status', 'complete', 'cancel'];
/** `timedOut` ends a `start` watch at its deadline; `expired` ends a `repeat` watch. */
export const FINAL_STATUSES = ['succeeded', 'timedOut', 'completed', 'expired', 'cancelled', 'failed'];

const text = (description, extra = {}) => ({ type: 'string', minLength: 1, description, ...extra });
const number = (minimum, maximum, description) => ({ type: 'number', minimum, maximum, description });

export const TOOL_DESCRIPTION = [
  'Background watches owned by this session. Never block a turn with sleep or polling loops: arm a watch, then end your turn or keep working.',
  '- start: run a side-effect-free shell `condition` now, then every intervalSeconds (default 30). Exit 0 means true. When it is true, times out, or fails, this session is woken with a receipt (wake=notify only shows the user a toast). If it is already true within a few seconds, the result comes back inline and no watch remains.',
  '- repeat: wake this session every intervalSeconds with a fixed `instruction` until timeoutSeconds. Requires instruction, quickRef and timeoutSeconds (absolute lifetime). Optional `condition` gates each tick. Call complete when the goal is achieved (a finished turn is not completion), cancel to stop without success.',
  '- list / status / cancel / complete take an `id`. Run list before re-arming: watches survive Esc, plugin reloads and server restarts, so re-arming by hand creates duplicates.',
  '- In a subagent, watches belong to the main session, which is woken instead of you: put the watch ID and what it waits for in your result, then finish.',
  'Write fail-closed conditions: exit 0 must prove fresh, positive evidence from this run (`grep -qx DONE out.txt`, `test -s result.json`), never the absence of something (`! pgrep job`) or a pipeline whose last command succeeds on nothing (`grep -c`). Do not arm a watch in the same tool batch that writes or resets what it reads; the first check runs immediately.',
  'A wake proves the condition was true when checked, not that work remains: confirm the result is unhandled before acting. Before re-arming a result watch, record consumed item IDs or a cursor and make the new condition reject handled results.',
  'Keep labels, instructions and contextRefs short and secret-free. Use a durable scheduler for work that must outlive this session.',
].join('\n');

export const toolInput = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ACTIONS, description: 'start | repeat | list | status | complete | cancel.' },
    condition: text('Side-effect-free shell command; exit 0 means true. Required for start; optional gate for repeat.', { maxLength: 4096 }),
    label: text('Short human label shown in the UI and receipts. No secrets.', { maxLength: 120 }),
    cwd: text('Directory for the condition. Defaults to the session directory; relative paths and ~ resolve from there.'),
    intervalSeconds: number(1, 86400, `Seconds between checks or recurring wakes. Default ${DEFAULT_INTERVAL_SECONDS}.`),
    checkTimeoutSeconds: number(1, 3600, `Limit for one check; a check that runs over counts as false. Default ${DEFAULT_CHECK_TIMEOUT_SECONDS}.`),
    timeoutSeconds: number(1, 2000000, 'Overall deadline from now. Optional for start (the agent is woken on timeout); required for repeat.'),
    wake: { type: 'string', enum: ['agent', 'notify'], description: 'start only. agent (default) wakes this session; notify only shows the user a toast.' },
    id: text('Watch ID for status, complete and cancel.'),
    instruction: text('repeat: the task given to this session on every wake.', { maxLength: 20000 }),
    quickRef: text('repeat: short human reference for the recurring task.', { maxLength: 500 }),
    contextRefs: {
      type: 'array', maxItems: 16, description: 'repeat: opaque { label, target } pointers passed through unresolved.',
      items: {
        type: 'object', additionalProperties: false, required: ['label', 'target'],
        properties: { label: text('Pointer name.', { maxLength: 120 }), target: text('Path, URL or identifier.', { maxLength: 2048 }) },
      },
    },
    immediate: { type: 'boolean', description: 'repeat: true wakes after this turn; otherwise the first wake follows one interval.' },
  },
};

const MAX = {
  intervalSeconds: [1, 86400], checkTimeoutSeconds: [1, 3600], timeoutSeconds: [1, 2000000],
};

function seconds(input, key, fallback) {
  const value = input[key];
  if (value === undefined) return fallback;
  const [min, max] = MAX[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be a number from ${min} to ${max}`);
  }
  return value;
}

function nonEmpty(value, name, max) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  if (max !== undefined && value.length > max) throw new Error(`${name} must be at most ${max} characters`);
  return value.trim();
}

const isDirectory = (dir) => { try { return statSync(dir).isDirectory(); } catch { return false; } };

function resolveCwd(base, value, check) {
  const raw = value ?? '.';
  const expanded = raw === '~' ? homedir() : raw.startsWith('~/') ? path.join(homedir(), raw.slice(2)) : raw;
  const dir = path.resolve(base, expanded);
  if (!check(dir)) throw new Error(`cwd is not a directory: ${dir}`);
  return dir;
}

function gate(input, context, required) {
  const command = nonEmpty(input.condition, 'condition', 4096);
  if (!command) {
    if (required) throw new Error('condition is required for action=start');
    return undefined;
  }
  return {
    command,
    cwd: resolveCwd(context.cwd, input.cwd, context.isDirectory ?? isDirectory),
    checkTimeoutMs: seconds(input, 'checkTimeoutSeconds', DEFAULT_CHECK_TIMEOUT_SECONDS) * 1000,
  };
}

/**
 * Parses tool/command input once into a command. Like pi-until, fields an action does not use are
 * ignored, and `null` means absent (OpenCode's tool-input repair also strips such placeholders):
 * `{ action: 'start' | 'repeat', definition } | { action: 'list' } | { action: 'status' | 'complete' | 'cancel', id }`.
 * `context`: `{ cwd, now, isDirectory? }`.
 */
export function parseCommand(input, context) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('until input must be an object');
  input = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null));
  const action = input.action;
  if (!ACTIONS.includes(action)) throw new Error(`action must be one of ${ACTIONS.join(', ')}`);
  if (action === 'list') return { action };
  if (action === 'status' || action === 'complete' || action === 'cancel') {
    const id = nonEmpty(input.id, 'id');
    if (!id) throw new Error(`id is required for action=${action}`);
    return { action, id };
  }
  const intervalMs = seconds(input, 'intervalSeconds', DEFAULT_INTERVAL_SECONDS) * 1000;
  const timeoutSeconds = seconds(input, 'timeoutSeconds', undefined);
  const label = nonEmpty(input.label, 'label', 120);
  if (action === 'start') {
    if (input.wake !== undefined && input.wake !== 'agent' && input.wake !== 'notify') throw new Error('wake must be agent or notify');
    return {
      action,
      definition: {
        kind: 'until', label: label ?? 'condition', wake: input.wake ?? 'agent', intervalMs,
        gate: gate(input, context, true),
        ...(timeoutSeconds === undefined ? {} : { expiresAt: context.now + timeoutSeconds * 1000 }),
      },
    };
  }
  const instruction = nonEmpty(input.instruction, 'instruction', 20000);
  if (!instruction) throw new Error('instruction is required for action=repeat');
  const quickRef = nonEmpty(input.quickRef, 'quickRef', 500);
  if (!quickRef) throw new Error('quickRef is required for action=repeat');
  if (timeoutSeconds === undefined) throw new Error('timeoutSeconds is required for action=repeat');
  if (input.wake === 'notify') throw new Error('repeat always wakes the agent; wake=notify is not supported');
  if (input.immediate !== undefined && typeof input.immediate !== 'boolean') throw new Error('immediate must be a boolean');
  const refs = input.contextRefs ?? [];
  if (!Array.isArray(refs) || refs.length > 16) throw new Error('contextRefs must be an array of at most 16 { label, target }');
  const contextRefs = refs.map((ref) => {
    if (!ref || typeof ref !== 'object') throw new Error('contextRefs entries must be { label, target }');
    return { label: nonEmpty(ref.label, 'contextRefs.label', 120), target: nonEmpty(ref.target, 'contextRefs.target', 2048) };
  });
  if (contextRefs.some((ref) => !ref.label || !ref.target)) throw new Error('contextRefs require non-empty label and target values');
  const condition = gate(input, context, false);
  return {
    action,
    definition: {
      kind: 'recurring', label: label ?? 'recurring follow-up', intervalMs,
      expiresAt: context.now + timeoutSeconds * 1000,
      first: input.immediate === true ? 'now' : 'afterInterval',
      ...(condition ? { gate: condition } : {}),
      snapshot: { instruction, quickRef, contextRefs, capturedAt: context.now },
    },
  };
}

export const wakeOf = (definition) => (definition.kind === 'until' ? definition.wake : 'agent');

export function initialFacts(definition, now) {
  return {
    status: 'running', startedAt: now, attempts: 0, deliveries: 0, missedTicks: 0, reloads: 0,
    nextDueAt: definition.kind === 'until' || definition.first === 'now' ? now : now + definition.intervalMs,
  };
}

const ticksDueThrough = (nextDueAt, intervalMs, now) => (nextDueAt > now ? 0 : Math.floor((now - nextDueAt) / intervalMs) + 1);

/** Consumes the current recurring tick and coalesces later ticks that are already due into `missedTicks`. */
export function advanceAfterTick(facts, intervalMs, now) {
  const next = facts.nextDueAt + intervalMs;
  const missed = ticksDueThrough(next, intervalMs, now);
  return { ...facts, missedTicks: facts.missedTicks + missed, nextDueAt: next + missed * intervalMs };
}

/** Coalesces ticks that became due while a delivered follow-up was running. */
export function coalescePastDue(facts, intervalMs, now) {
  const missed = ticksDueThrough(facts.nextDueAt, intervalMs, now);
  return missed === 0 ? facts : { ...facts, missedTicks: facts.missedTicks + missed, nextDueAt: facts.nextDueAt + missed * intervalMs };
}

export const watchID = () => randomBytes(4).toString('hex');

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
let lastMessageTime = 0, messageCounter = 0;
/** An ascending `msg_` ID in OpenCode's own format; persisted before sending so retries stay idempotent. */
export function messageID(now = Date.now()) {
  if (now !== lastMessageTime) { lastMessageTime = now; messageCounter = 0; }
  messageCounter++;
  const value = BigInt(now) * 0x1000n + BigInt(messageCounter);
  const time = Array.from({ length: 6 }, (_, i) => Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')).join('');
  return `msg_${time}${Array.from(randomBytes(14), (byte) => BASE62[byte % 62]).join('')}`;
}

/** Groups conditions in telemetry without writing any fragment of the command. */
export const hashCondition = (command) => createHash('sha256').update(command.trim()).digest('hex').slice(0, 12);

export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60), secs = total % 60;
  if (minutes < 60) return `${minutes}m${String(secs).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
}

const iso = (ms) => new Date(ms).toISOString();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Agent/RPC view of a stored watch. Includes the condition (the agent wrote it); never outputs. */
export function receipt(watch, now = Date.now()) {
  const { definition: d, facts: f } = watch;
  return {
    id: watch.id, kind: d.kind, label: d.label, status: f.status, wake: wakeOf(d),
    ...(watch.origin ? { armedBy: watch.origin } : {}),
    ...(d.gate ? { condition: d.gate.command, cwd: d.gate.cwd } : {}),
    intervalSeconds: d.intervalMs / 1000,
    attempts: f.attempts, deliveries: f.deliveries, missedTicks: f.missedTicks, reloads: f.reloads,
    startedAt: iso(f.startedAt), elapsed: formatDuration((f.finishedAt ?? now) - f.startedAt),
    ...(f.status === 'running' ? { nextDueAt: iso(f.nextDueAt) } : {}),
    ...(d.expiresAt === undefined ? {} : { expiresAt: iso(d.expiresAt) }),
    ...(f.finishedAt === undefined ? {} : { finishedAt: iso(f.finishedAt) }),
    ...(f.lastResult ? { lastExitCode: f.lastResult.code, lastCheckKilled: f.lastResult.killed } : {}),
    ...(d.kind === 'recurring' ? { quickRef: d.snapshot.quickRef, deliveryPending: watch.delivery !== undefined } : {}),
    ...(f.failure ? { failure: f.failure } : {}),
    ...(watch.notice?.state === 'failed' ? { wakeFailed: true } : {}),
  };
}

export function receiptText(r) {
  const lines = [`until watch ${r.id}: ${r.status}`, `Kind: ${r.kind}`, `Label: ${r.label}`];
  if (r.armedBy) lines.push(`Armed by: ${armedBy(r.armedBy)}`);
  if (r.condition) lines.push(`Condition: ${r.condition}`, `Cwd: ${r.cwd}`);
  lines.push(`Checks: ${r.attempts}`, `Elapsed: ${r.elapsed}`);
  if (r.kind === 'recurring') {
    lines.push(`Deliveries: ${r.deliveries}`, `Delivery pending: ${r.deliveryPending ? 'yes' : 'no'}`, `Missed ticks: ${r.missedTicks}`, `Quick ref: ${r.quickRef}`);
  }
  if (r.nextDueAt) lines.push(`Next due: ${r.nextDueAt}`);
  if (r.expiresAt) lines.push(`Expires: ${r.expiresAt}`);
  if (r.reloads > 0) lines.push(`Survived reloads: ${r.reloads}`);
  if (r.lastExitCode !== undefined) lines.push(`Last exit code: ${r.lastExitCode}`);
  if (r.lastCheckKilled) lines.push('Last check ran past checkTimeoutSeconds and was terminated (counted as false).');
  if (r.failure) lines.push(`Failure: ${r.failure}`);
  if (r.wakeFailed) lines.push('Wake delivery failed; the session was not resumed for this result.');
  return lines.join('\n');
}

const armedBy = (origin) => `subagent session ${origin.sessionID}${origin.title ? ` (${origin.title})` : ''}`;

export function listText(receipts) {
  if (!receipts.length) return 'No until watches in this session.';
  return receipts.map((r) => `${r.id}\t${r.status}\t${r.kind}\t${r.label}\tchecks=${r.attempts}${r.kind === 'recurring' ? `\twakes=${r.deliveries}` : ''}${r.armedBy ? `\tby=${r.armedBy.sessionID}` : ''}`).join('\n');
}

export function startedText(watch) {
  const { definition: d, facts: f } = watch;
  const expires = d.expiresAt === undefined ? '' : `, until ${iso(d.expiresAt)}`;
  const sub = watch.origin !== undefined;
  const woken = sub ? `The main session (${watch.sessionID}) wakes, not you,` : 'This session wakes';
  const timing = d.kind === 'until'
    ? `Checks now, then every ${d.intervalMs / 1000}s${expires || ' with no deadline'}. ${d.wake === 'agent'
      ? `${woken} with a receipt when it is true, times out, or fails: ${sub ? 'put the watch ID and what it waits for in your result, then finish' : 'end your turn or keep working; do not poll'}.`
      : 'The user gets a toast when it finishes; nobody is woken.'}`
    : `First wake ${d.first === 'now' ? 'after this turn' : `at ${iso(f.nextDueAt)}`}, then every ${d.intervalMs / 1000}s${expires}. ${sub ? `Wakes go to the main session (${watch.sessionID}); put the watch ID in your result.` : `Call until action=complete id=${watch.id} when the goal is achieved.`}`;
  return `Started until ${d.kind === 'until' ? 'watch' : 'recurring watch'} ${watch.id} (${d.label}). ${timing}`;
}

const WAKE_INSTRUCTIONS = {
  succeeded: 'The condition was true when checked. Before acting, confirm the task still needs work and the matching result is unhandled. If the task is finished, stop. Do not act on a handled result again. Re-arm only for continuing work, after recording consumed item IDs or a source cursor and excluding handled results.',
  timedOut: 'The watch timed out before the condition became true. Inspect the receipt and decide what to do next.',
  failed: 'The watch failed. Inspect the receipt and decide what to do next.',
};

const contextLines = (snapshot) => snapshot.contextRefs.map((ref) => `- ${ref.label}: \`${ref.target}\``);

/**
 * The terminal wake for a finished watch, or undefined when nobody is woken.
 * `{ text, description }`: `text` goes to the model, `description` is the transcript notice.
 */
export function terminalWake(watch, now = Date.now()) {
  const { definition: d, facts: f } = watch;
  const r = receipt(watch, now);
  const notice = (what) => `until · ${d.label} · ${what}${watch.origin ? ' · from subagent' : ''}`;
  if (d.kind === 'until') {
    if (d.wake !== 'agent' || !WAKE_INSTRUCTIONS[f.status]) return undefined;
    const what = { succeeded: `condition met after ${plural(f.attempts, 'check')} (${r.elapsed})`, timedOut: `timed out after ${plural(f.attempts, 'check')}`, failed: 'failed' }[f.status];
    return { text: `${WAKE_INSTRUCTIONS[f.status]}\n\n${receiptText(r)}`, description: notice(what) };
  }
  if (f.status === 'expired') {
    return {
      description: notice(`expired after ${plural(f.deliveries, 'wake')}`),
      text: [
        '# Recurring follow-up expired', '', 'This recurrence is no longer active. Do not continue its task unless the user asks.', '',
        '## Quick reference', d.snapshot.quickRef, '', '## Receipt', `- Watch: \`${watch.id}\``, '- Status: expired',
        `- Deliveries: ${f.deliveries}`, `- Missed ticks: ${f.missedTicks}`, `- Expired: ${iso(d.expiresAt)}`, `- Survived reloads: ${f.reloads}`,
        ...(d.snapshot.contextRefs.length ? ['', '## Context', ...contextLines(d.snapshot)] : []),
      ].join('\n'),
    };
  }
  if (f.status === 'failed') {
    return { description: notice('failed'), text: `The recurring watch failed. Inspect this receipt before deciding what to do.\n\n${receiptText(r)}` };
  }
  return undefined;
}

/** One recurring wake. `facts` are already advanced past this delivery. */
export function recurringWake(watch, deliveredAt) {
  const { definition: d, facts: f } = watch;
  const missed = f.missedTicks ? ` (${f.missedTicks} missed)` : '';
  return {
    description: `until · ${d.label} · wake ${f.deliveries}${missed}${watch.origin ? ' · from subagent' : ''}`,
    text: [
      '# Recurring follow-up', '', '## Instruction', d.snapshot.instruction, '', '## Quick reference', d.snapshot.quickRef, '',
      '## Receipt', `- Watch: \`${watch.id}\``, ...(watch.origin ? [`- Armed by: ${armedBy(watch.origin)}`] : []), `- Delivery: ${f.deliveries}`, `- Missed ticks: ${f.missedTicks}`,
      `- Delivered: ${iso(deliveredAt)}`, `- Next due: ${iso(f.nextDueAt)}`, `- Expires: ${iso(d.expiresAt)}`, `- Survived reloads: ${f.reloads}`,
      ...(d.snapshot.contextRefs.length ? ['', '## Context', ...contextLines(d.snapshot)] : []),
      '', '## Control',
      `Call \`until\` with \`action=complete\` and \`id=${watch.id}\` when the goal is achieved.`,
      `Call \`until\` with \`action=cancel\` and \`id=${watch.id}\` to abort it.`,
    ].join('\n'),
  };
}

/** The user-facing toast for a finished `wake=notify` watch. */
export function notifyToast(watch) {
  const { definition: d, facts: f } = watch;
  if (d.kind !== 'until' || d.wake !== 'notify' || !WAKE_INSTRUCTIONS[f.status]) return undefined;
  return {
    title: `until · ${d.label}`,
    message: f.status === 'succeeded' ? 'condition met' : f.status === 'timedOut' ? 'timed out' : `failed${f.failure ? `: ${f.failure}` : ''}`,
    variant: f.status === 'succeeded' ? 'success' : f.status === 'timedOut' ? 'warning' : 'error',
  };
}
