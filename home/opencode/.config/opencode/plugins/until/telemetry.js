// Local usage telemetry: one JSON object per line in a file this user owns. Nothing leaves the
// machine; conditions are written only as a 12-character hash, task text never.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const TELEMETRY_VERSION = 1;

export function telemetryOptions(env = process.env) {
  const state = env.XDG_STATE_HOME?.trim() || path.join(homedir(), '.local', 'state');
  return {
    enabled: env.OPENCODE_UNTIL_TELEMETRY !== '0',
    filePath: env.OPENCODE_UNTIL_TELEMETRY_FILE?.trim() || path.join(state, 'opencode', 'until', 'events.jsonl'),
  };
}

export function createTelemetry({ enabled = true, filePath, now = Date.now } = {}) {
  let ready, queue = Promise.resolve();
  const write = async (line) => {
    try {
      ready ??= mkdir(path.dirname(filePath), { recursive: true });
      await ready;
      await appendFile(filePath, line, 'utf8');
    } catch { /* telemetry never breaks a watch */ }
  };
  return {
    enabled, filePath,
    record(sessionID, event) {
      if (!enabled) return;
      const line = `${JSON.stringify({ ...event, at: new Date(now()).toISOString(), sessionID, v: TELEMETRY_VERSION })}\n`;
      // One append at a time keeps lines in event order.
      queue = queue.then(() => write(line));
    },
    flush: () => queue,
  };
}

const EVENTS = new Set(['started', 'finished', 'resumed', 'action']);

export function parseTelemetry(text) {
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && event.v === TELEMETRY_VERSION && EVENTS.has(event.event) && typeof event.sessionID === 'string') events.push(event);
    } catch { /* skip torn or foreign lines */ }
  }
  return events;
}

export async function readTelemetry(filePath) {
  try { return parseTelemetry(await readFile(filePath, 'utf8')); } catch { return []; }
}

const median = (values) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const count = (tally, key) => { tally[key] = (tally[key] ?? 0) + 1; };

export function summarize(events) {
  const actions = {}, byStatus = {}, byWake = {}, byKind = {}, sessions = new Set(), attempts = [], durations = [];
  let started = 0, finished = 0, resumed = 0;
  for (const event of events) {
    sessions.add(event.sessionID);
    if (event.event === 'started' && !event.resumed) { started++; count(byWake, event.wake); count(byKind, event.kind); }
    if (event.event === 'finished') { finished++; count(byStatus, event.status); attempts.push(event.attempts); durations.push(event.durationMs); }
    if (event.event === 'resumed') resumed += event.count;
    if (event.event === 'action') count(actions, `${event.source}:${event.action}`);
  }
  return { actions, byStatus, byWake, byKind, finished, started, resumed, sessions: sessions.size, medianAttempts: median(attempts), medianDurationMs: median(durations) };
}

const duration = (ms) => {
  if (ms === undefined) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
};
const tally = (values) => Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join(' ') || 'none';

export function summaryText(summary, filePath) {
  return [
    `until stats (${filePath})`,
    `Sessions: ${summary.sessions}`,
    `Watches started: ${summary.started}  finished: ${summary.finished}`,
    `By kind: ${tally(summary.byKind)}`,
    `By status: ${tally(summary.byStatus)}`,
    `By wake: ${tally(summary.byWake)}`,
    `Median checks: ${summary.medianAttempts ?? 'n/a'}  median duration: ${duration(summary.medianDurationMs)}`,
    `Restored after restart: ${summary.resumed}`,
    `Actions: ${tally(summary.actions)}`,
  ].join('\n');
}
