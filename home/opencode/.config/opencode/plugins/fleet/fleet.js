// Pure Fleet model for the ocb terminal view: wire shape checks, live row map, the state-first
// board, the footer badge and notification transitions. No host, network or clock access.
// Wire schema: fleet repo `lib/data/fleet/types.ts` (FleetSnapshot, FleetChange, FleetRow);
// board rules mirror `lib/data/fleet/board.ts` (sections newest first, idle listed for 24h).

export const STATES = ['needs-you', 'failed', 'working', 'done', 'idle'];
export const ACTIVE = ['needs-you', 'failed', 'working', 'done'];
export const IDLE_WINDOW = 24 * 60 * 60 * 1000;

const object = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const string = (v) => typeof v === 'string';
const number = (v) => typeof v === 'number' && Number.isFinite(v);
const optional = (v, check) => v === undefined || check(v);
const state = (v) => STATES.includes(v);
// Display text: single line, bounded, no control characters from the wire.
const clean = (v, max = 200) => string(v) ? v.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max) : undefined;

function parseActivity(v) {
  if (!object(v) || !['thinking', 'writing', 'tool'].includes(v.kind)) return undefined;
  return { kind: v.kind, tool: clean(v.tool, 40), detail: clean(v.detail, 120) };
}

/** One root row, or undefined when the shape is not a Fleet row. */
export function parseRow(v) {
  if (!object(v) || !string(v.id) || !v.id || !string(v.projectID) || !string(v.directory) ||
      !state(v.state) || !optional(v.ownState, state) || !number(v.updated) || !optional(v.idle, number) ||
      !optional(v.title, string)) return undefined;
  const pending = object(v.pending) && number(v.pending.permissions) && number(v.pending.forms)
    ? { permissions: v.pending.permissions, forms: v.pending.forms }
    : { permissions: Array.isArray(v.permissions) ? v.permissions.length : 0, forms: Array.isArray(v.forms) ? v.forms.length : 0 };
  const web = object(v.links) && string(v.links.web) && /^https?:\/\//.test(v.links.web) ? v.links.web : undefined;
  const retry = object(v.retry) && number(v.retry.attempt) ? { attempt: v.retry.attempt } : undefined;
  return {
    id: v.id, projectID: v.projectID, directory: v.directory, title: clean(v.title), state: v.state,
    ownState: v.ownState ?? v.state, updated: v.updated, idle: v.idle, unseen: v.unseen === true,
    running: v.running === true, activity: parseActivity(v.activity), retry, pending, web,
  };
}

function parseConnection(v) {
  return object(v) && ['connecting', 'connected', 'disconnected'].includes(v.status) ? v.status : 'disconnected';
}

/** `GET /api/fleet` body → live model, or undefined when the top-level shape is wrong. */
export function parseSnapshot(v) {
  if (!object(v) || !Array.isArray(v.projects)) return undefined;
  const rows = new Map(), projects = new Map(), worktrees = new Map();
  for (const p of v.projects) {
    if (!object(p) || !string(p.id) || !string(p.directory) || !Array.isArray(p.worktrees)) continue;
    projects.set(p.id, { name: clean(p.name, 80) || p.directory, directory: p.directory });
    for (const w of p.worktrees) {
      if (!object(w) || !string(w.directory) || !Array.isArray(w.rows)) continue;
      if (['root', 'worktree', 'directory'].includes(w.kind)) worktrees.set(w.directory, w.kind);
      for (const r of w.rows) { const row = parseRow(r); if (row) rows.set(row.id, row); }
    }
  }
  return { connection: parseConnection(v.connection), rows, projects, worktrees };
}

/** `fleet.changed` payload → change, or undefined. Invalid rows are dropped, not fatal. */
export function parseChange(v) {
  if (!object(v) || typeof v.initial !== 'boolean' || !Array.isArray(v.rows) || !Array.isArray(v.removed)) return undefined;
  return {
    initial: v.initial, connection: parseConnection(v.connection),
    rows: v.rows.map(parseRow).filter(Boolean), removed: v.removed.filter(string),
  };
}

/** Applies a change; `stale` asks for a snapshot reload (a row of an unknown project). */
export function applyChange(live, change) {
  const rows = new Map(live.rows);
  for (const id of change.removed) rows.delete(id);
  for (const row of change.rows) rows.set(row.id, row);
  return { live: { ...live, connection: change.connection, rows }, stale: change.rows.some((r) => !live.projects.has(r.projectID)) };
}

export const lastActivity = (row) => Math.max(row.updated, row.idle ?? 0);
const lastSegment = (dir) => dir.split('/').filter(Boolean).at(-1) ?? dir;

/** Names a row is shown under: project, and worktree/subdirectory unless it is the project root. */
export function names(live, row) {
  const project = live.projects.get(row.projectID);
  if (!project || project.directory === '/') return { project: lastSegment(row.directory), worktree: undefined };
  const kind = live.worktrees.get(row.directory);
  if (kind === 'root' || row.directory === project.directory) return { project: project.name, worktree: undefined };
  const prefix = project.directory.endsWith('/') ? project.directory : `${project.directory}/`;
  if (kind === 'directory' && row.directory.startsWith(prefix)) return { project: project.name, worktree: row.directory.slice(prefix.length) };
  return { project: project.name, worktree: lastSegment(row.directory) };
}

/** `project · worktree · title` (worktree only when not the project's own checkout). */
export function rowLabel(live, row) {
  const n = names(live, row);
  return [n.project, n.worktree, row.title || 'Untitled'].filter(Boolean).join(' · ');
}

/**
 * State-first board: active sections in priority order (newest first, empty ones omitted),
 * then idle rows whose last activity is within 24h. Counts cover what the board lists.
 */
export function buildBoard(live, now) {
  const rows = [...live.rows.values()].sort((a, b) => lastActivity(b) - lastActivity(a));
  const sections = ACTIVE.map((s) => ({ state: s, rows: rows.filter((r) => r.state === s) })).filter((s) => s.rows.length);
  const idle = rows.filter((r) => r.state === 'idle' && lastActivity(r) >= now - IDLE_WINDOW);
  const counts = Object.fromEntries(ACTIVE.map((s) => [s, sections.find((x) => x.state === s)?.rows.length ?? 0]));
  return { sections, idle, counts: { ...counts, idle: idle.length } };
}

const LABELS = { 'needs-you': (n) => (n === 1 ? 'needs you' : 'need you'), failed: () => 'failed', working: () => 'working', done: () => 'done' };

/** Badge parts for non-zero active states, e.g. `2 need you`, in priority order. */
export function badgeParts(counts) {
  return ACTIVE.filter((s) => counts[s] > 0).map((s) => ({ state: s, text: `${counts[s]} ${LABELS[s](counts[s])}` }));
}

export const BADGE_MARK = '⚑';

export const badgeText = (counts) => {
  const parts = badgeParts(counts);
  return parts.length ? `${BADGE_MARK} ${parts.map((p) => p.text).join(' · ')}` : '';
};

/**
 * What the footer shows: hidden without data, when Fleet is unreachable, or when everything is
 * idle; `subtle` while reconnecting or while Fleet itself lost OpenCode (data may be stale).
 */
export function badgeView(status, live, now) {
  if (!live || status === 'unreachable') return { visible: false };
  const counts = buildBoard(live, now).counts;
  const parts = badgeParts(counts);
  if (!parts.length) return { visible: false };
  return { visible: true, subtle: status !== 'live' || live.connection !== 'connected', parts, text: badgeText(counts) };
}

/** Compact age: now, 45s, 5m, 3h, 2d. */
export function formatAge(ms) {
  if (!(ms >= 0)) return '';
  const s = Math.floor(ms / 1000);
  if (s < 10) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Right-hand detail of a row: what it waits on or is doing, then its age. */
export function rowDetail(row, now) {
  const age = formatAge(now - lastActivity(row));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  let what;
  if (row.state === 'needs-you') {
    const { permissions, forms } = row.pending;
    what = [permissions && plural(permissions, 'permission'), forms && plural(forms, 'question')].filter(Boolean).join(', ') || 'needs you';
    if (row.ownState !== 'needs-you') what += ' (subagent)';
  } else if (row.state === 'working') {
    const a = row.activity;
    what = row.retry ? `retry ${row.retry.attempt}` : !a ? 'working'
      : a.kind === 'tool' ? [a.tool ?? 'tool', a.detail].filter(Boolean).join(': ') : a.kind;
  } else if (row.state === 'failed') what = 'failed';
  return [what, age].filter(Boolean).join(' · ');
}

/**
 * Root rows that just entered needs-you or done, comparing two consecutive live states.
 * `mode`: `all` (every transition), `gaps` (only needs-you rolled up from a subagent, which
 * OpenCode's builtin notifications plugin shows as sound only), `off`.
 */
export function transitions(previous, next, mode = 'gaps') {
  if (!previous || !next || mode === 'off') return [];
  const result = [];
  for (const row of next.rows.values()) {
    const before = previous.rows.get(row.id)?.state;
    if (row.state === before) continue;
    if (row.state === 'needs-you' && (mode === 'all' || row.ownState !== 'needs-you')) result.push({ kind: 'needs-you', row });
    else if (row.state === 'done' && mode === 'all' && before !== undefined) result.push({ kind: 'done', row });
  }
  return result;
}

/** One notification text for a batch of transitions (needs-you first), or undefined. */
export function notification(live, batch) {
  if (!batch.length) return undefined;
  const needs = batch.filter((t) => t.kind === 'needs-you'), done = batch.filter((t) => t.kind === 'done');
  const first = needs[0] ?? done[0];
  if (batch.length === 1) return { title: 'Fleet', message: `${rowLabel(live, first.row)} ${first.kind === 'done' ? 'is done' : 'needs you'}` };
  const parts = [needs.length && `${needs.length} ${needs.length === 1 ? 'needs' : 'need'} you`, done.length && `${done.length} done`].filter(Boolean);
  return { title: 'Fleet', message: `${parts.join(' · ')} — ${rowLabel(live, first.row)}` };
}

/**
 * Next needs-you session after the current one (by root id), in board order, wrapping; the
 * first one when the current session is not in the list.
 */
export function nextNeedsYou(board, currentRootID) {
  const rows = board.sections.find((s) => s.state === 'needs-you')?.rows ?? [];
  if (!rows.length) return undefined;
  const index = rows.findIndex((r) => r.id === currentRootID);
  return rows[(index + 1) % rows.length];
}

/** 1s, 2s, 4s, ... capped at 30s. */
export const reconnectDelay = (attempt) => Math.min(30_000, 1000 * 2 ** attempt);

/** Base URL from plugin option, then env, then default; http(s) only, no trailing slash. */
export function resolveBaseURL(option, env, fallback = 'https://fleet.oox.sh') {
  for (const value of [option, env]) {
    if (!string(value) || !value.trim()) continue;
    try {
      const url = new URL(value.trim());
      if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href.replace(/\/+$/, '');
    } catch { /* fall through to the next source */ }
  }
  return fallback;
}

export const notifyMode = (v) => (['all', 'gaps', 'off'].includes(v) ? v : 'gaps');
