// Pure Fleet model for the ocb terminal view: wire shape checks, the live row map, the needs-me
// list, counts, badge, row reasons, notification transitions and the launcher list. No host,
// network or clock access.
// Wire schema: fleet repo `lib/data/fleet/types.ts` (FleetSnapshot, FleetChange, FleetRow, Launch,
// LauncherList). Rules mirror `state.ts` (stuck, counts), `board.ts` (needs-me and working order,
// optimistic overrides) and `app/fleet-format.ts` (labels).

export const STATES = ['blocked', 'working', 'finished', 'handled'];
const OUTCOMES = ['succeeded', 'failed', 'interrupted'];
const INTERRUPTS = ['user', 'inactivity', 'shutdown', 'superseded'];
export const LAUNCH_STATUSES = ['provisioning', 'creating-session', 'ready', 'failed'];
/** A working session with no step/tool/text activity for this long is quiet (stuck). */
export const QUIET_AFTER = 10 * 60 * 1000;

const object = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const string = (v) => typeof v === 'string';
const number = (v) => typeof v === 'number' && Number.isFinite(v);
const boolean = (v) => typeof v === 'boolean';
const optional = (v, check) => v === undefined || check(v);
const oneOf = (values) => (v) => values.includes(v);
const state = oneOf(STATES);
// Display text: single line, bounded, no control characters from the wire.
export const clean = (v, max = 200) => string(v) ? v.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max) : undefined;

function parseActivity(v) {
  if (!object(v) || !['thinking', 'writing', 'tool'].includes(v.kind)) return undefined;
  return { kind: v.kind, tool: clean(v.tool, 40), detail: clean(v.detail, 120) };
}

const parseRetry = (v) => object(v) && number(v.attempt) && number(v.at) && string(v.message)
  ? { attempt: v.attempt, at: v.at, message: clean(v.message, 80) } : undefined;

const parsePermission = (v) => object(v) && string(v.id) && string(v.action) && Array.isArray(v.resources)
  ? { id: v.id, action: clean(v.action, 60), resources: v.resources.filter(string).map((r) => clean(r, 120)) } : undefined;

const parseForm = (v) => object(v) && string(v.id) && string(v.title) && Array.isArray(v.fields)
  ? { id: v.id, title: clean(v.title, 120) } : undefined;

const list = (v, parse) => v.map(parse).filter(Boolean);

/** Fields every row and child row must carry with the right type; the rest is display-only. */
function core(v) {
  return object(v) && string(v.id) && v.id !== '' && state(v.state) && state(v.ownState) && boolean(v.running) &&
    optional(v.idle, number) && optional(v.activityAt, number) && optional(v.outcome, oneOf(OUTCOMES)) &&
    optional(v.interrupt, oneOf(INTERRUPTS)) && optional(v.title, string) && optional(v.agent, string) &&
    Array.isArray(v.permissions) && Array.isArray(v.forms);
}

function parseChild(v) {
  if (!core(v)) return undefined;
  return {
    id: v.id, title: clean(v.title), agent: clean(v.agent, 40), state: v.state, ownState: v.ownState, running: v.running,
    activityAt: v.activityAt, retry: parseRetry(v.retry), permissions: list(v.permissions, parsePermission), forms: list(v.forms, parseForm),
  };
}

/** One root row (Fleet's `FleetRow`), or undefined when the shape is not a Fleet row. */
export function parseRow(v) {
  if (!core(v) || !string(v.projectID) || !string(v.directory) || !number(v.created) || !number(v.activeAt) ||
      !boolean(v.gone) || !optional(v.handled, number) || !object(v.pending) || !number(v.pending.permissions) ||
      !number(v.pending.forms) || !Array.isArray(v.children)) return undefined;
  const web = object(v.links) && string(v.links.web) && /^https?:\/\//.test(v.links.web) ? v.links.web : undefined;
  return {
    id: v.id, projectID: v.projectID, directory: v.directory, title: clean(v.title), agent: clean(v.agent, 40),
    created: v.created, idle: v.idle, outcome: v.outcome, interrupt: v.interrupt, handled: v.handled, gone: v.gone,
    state: v.state, ownState: v.ownState, running: v.running, retry: parseRetry(v.retry), activity: parseActivity(v.activity),
    activityAt: v.activityAt, activeAt: v.activeAt,
    pending: { permissions: v.pending.permissions, forms: v.pending.forms },
    permissions: list(v.permissions, parsePermission), forms: list(v.forms, parseForm), children: list(v.children, parseChild), web,
  };
}

/** One launcher launch (Fleet's `Launch`), or undefined. */
export function parseLaunch(v) {
  if (!object(v) || !string(v.id) || !v.id || !string(v.repo) || !string(v.repoName) || !string(v.branch) || !string(v.task) ||
      !LAUNCH_STATUSES.includes(v.status) || !number(v.startedAt) || !number(v.updatedAt) || !optional(v.sessionID, string) ||
      !optional(v.directory, string) || !optional(v.error, string) || !optional(v.preserved, string)) return undefined;
  return {
    id: v.id, repo: v.repo, repoName: clean(v.repoName, 80), branch: clean(v.branch, 120), task: clean(v.task, 300), status: v.status,
    directory: v.directory, sessionID: v.sessionID, error: clean(v.error, 300), preserved: clean(v.preserved, 200),
    startedAt: v.startedAt, updatedAt: v.updatedAt,
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
  const launches = Array.isArray(v.launches) ? list(v.launches, parseLaunch) : [];
  return { connection: parseConnection(v.connection), rows, projects, worktrees, launches };
}

/** `fleet.changed` payload → change, or undefined. Invalid rows are dropped, not fatal. */
export function parseChange(v) {
  if (!object(v) || typeof v.initial !== 'boolean' || !Array.isArray(v.rows) || !Array.isArray(v.removed)) return undefined;
  return {
    initial: v.initial, connection: parseConnection(v.connection),
    rows: list(v.rows, parseRow), removed: v.removed.filter(string),
    // Every launch when any changed; absent when none did.
    launches: Array.isArray(v.launches) ? list(v.launches, parseLaunch) : undefined,
  };
}

/** Applies a change; `stale` asks for a snapshot reload (a row of an unknown project). */
export function applyChange(live, change) {
  const rows = new Map(live.rows);
  for (const id of change.removed) rows.delete(id);
  for (const row of change.rows) rows.set(row.id, row);
  return {
    live: { ...live, connection: change.connection, rows, launches: change.launches ?? live.launches },
    stale: change.rows.some((r) => !live.projects.has(r.projectID)),
  };
}

/**
 * Optimistic Handled / Undo: `overrides` maps a row id to `{ base, target }`; the row shows as
 * `target` while the live row is still `base` (until the server sends anything new for it).
 */
export function withOverrides(live, overrides) {
  if (!live || !overrides.size) return live;
  let rows;
  for (const [id, { base, target }] of overrides) {
    if (live.rows.get(id) !== base) continue;
    const next = overridden(base, target);
    if (next === base) continue;
    rows ??= new Map(live.rows);
    rows.set(id, next);
  }
  return rows ? { ...live, rows } : live;
}

function overridden(row, target) {
  if (target === 'handled') return row.state === 'finished' ? { ...row, state: 'handled', ownState: 'handled', handled: row.idle } : row;
  if (row.state !== 'handled' || row.idle === undefined) return row;
  return { ...row, state: 'finished', ownState: 'finished', handled: undefined };
}

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

/** `project · worktree` (worktree only when not the project's own checkout). */
export const placeLabel = (live, row) => { const n = names(live, row); return [n.project, n.worktree].filter(Boolean).join(' · '); };

export const titleOf = (row) => row.title || 'Untitled';

/** `project · worktree · title`. */
export const rowLabel = (live, row) => `${placeLabel(live, row)} · ${titleOf(row)}`;

const runningRows = (row) => [row, ...row.children].filter((r) => r.running);

/** Latest activity across the row's running subtree (a parent waits while a subagent works). */
export function lastActivityAt(row) {
  const times = runningRows(row).map((r) => r.activityAt).filter(number);
  return times.length ? Math.max(...times) : undefined;
}

/** The retry a running session in the row's subtree is waiting on, if any. */
export const pendingRetry = (row) => runningRows(row).find((r) => r.retry)?.retry;

/** Working, and nothing in its running subtree has done anything for `QUIET_AFTER`. */
export function isQuiet(row, now) {
  const last = lastActivityAt(row);
  return row.state === 'working' && last !== undefined && now - last >= QUIET_AFTER;
}

/** Stuck is not a state: a working row that is retrying or quiet. */
export const isStuck = (row, now) => row.state === 'working' && (pendingRetry(row) !== undefined || isQuiet(row, now));

/** Root rows by rolled-up state, plus the stuck working ones (Fleet's `countRows`). */
export function countRows(rows, now) {
  const counts = { blocked: 0, finished: 0, working: 0, stuck: 0, handled: 0 };
  for (const row of rows) {
    counts[row.state] += 1;
    if (isStuck(row, now)) counts.stuck += 1;
  }
  return counts;
}

const oldestFirst = (a, b) => a.activeAt - b.activeAt;

/**
 * What the terminal lists: needs me (blocked, longest wait first, then finished, oldest first; a
 * blocked run stopped moving when it asked, so `activeAt` is when the wait began) and working
 * (stuck first, then the newest session by `created`, so live activity does not reshuffle it).
 */
export function buildBoard(live, now) {
  const rows = [...live.rows.values()];
  const blocked = rows.filter((r) => r.state === 'blocked').sort(oldestFirst);
  const finished = rows.filter((r) => r.state === 'finished').sort(oldestFirst);
  const working = rows.filter((r) => r.state === 'working')
    .sort((a, b) => Number(isStuck(b, now)) - Number(isStuck(a, now)) || b.created - a.created);
  return { blocked, finished, needsMe: [...blocked, ...finished], working, counts: countRows(rows, now) };
}

/**
 * The next needs-me session after the current one (by root id), in list order, wrapping; the
 * first one when the current session is not listed.
 */
export function nextNeedsMe(order, currentRootID) {
  if (!order.length) return undefined;
  const index = order.findIndex((r) => r.id === currentRootID);
  return order[(index + 1) % order.length];
}

/** Badge parts, non-zero only: `2 need you`, `3 working`, `1 stuck`. */
export function badgeParts(counts) {
  const needMe = counts.blocked + counts.finished;
  return [
    needMe > 0 && { kind: 'need', text: `${needMe} ${needMe === 1 ? 'needs you' : 'need you'}` },
    counts.working > 0 && { kind: 'working', text: `${counts.working} working` },
    counts.stuck > 0 && { kind: 'stuck', text: `${counts.stuck} stuck` },
  ].filter(Boolean);
}

export const BADGE_MARK = '⚑';

export const badgeText = (counts) => {
  const parts = badgeParts(counts);
  return parts.length ? `${BADGE_MARK} ${parts.map((p) => p.text).join(' · ')}` : '';
};

/**
 * What the footer shows: hidden without data, when Fleet is unreachable, or when nothing needs me
 * and nothing works; `subtle` while reconnecting or while Fleet itself lost OpenCode.
 */
export function badgeView(status, live, now) {
  if (!live || status === 'unreachable') return { visible: false };
  const counts = countRows([...live.rows.values()], now);
  const parts = badgeParts(counts);
  if (!parts.length) return { visible: false };
  return { visible: true, subtle: status !== 'live' || live.connection !== 'connected', parts, text: badgeText(counts) };
}

const minute = 60 * 1000, hour = 60 * minute, day = 24 * hour;

/** Compact age (Fleet's `relativeTime`): now, 4m, 3h, 2d. */
export function relativeTime(at, now) {
  const age = Math.max(0, now - at);
  if (age < minute) return 'now';
  if (age < hour) return `${Math.floor(age / minute)}m`;
  if (age < day) return `${Math.floor(age / hour)}h`;
  return `${Math.floor(age / day)}d`;
}

/** Elapsed clock: 0:07, 3:05, 1:02:10. */
export function elapsedText(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** `1 permission · 2 questions` (whole subtree). */
export const pendingText = (row) => [
  row.pending.permissions && plural(row.pending.permissions, 'permission', 'permissions'),
  row.pending.forms && plural(row.pending.forms, 'question', 'questions'),
].filter(Boolean).join(' · ');

/**
 * What a blocked row waits on: its first pending request (own first, then each subagent's, as
 * `<agent> asks: …`), `+N` more; else the pending counts.
 */
export function askText(row) {
  const sources = [{ session: row }, ...row.children.map((c) => ({ session: c, subagent: c.agent || c.title || c.id }))];
  for (const { session, subagent } of sources) {
    const permission = session.permissions[0];
    const form = session.forms[0];
    const what = permission ? (permission.resources.length ? `${permission.action}: ${permission.resources.join(', ')}` : permission.action)
      : form?.title;
    if (!what) continue;
    const more = row.pending.permissions + row.pending.forms - 1;
    return `${subagent ? `${subagent} asks: ` : ''}${what}${more > 0 ? ` (+${more})` : ''}`;
  }
  return pendingText(row) || 'needs you';
}

/** How the latest run ended when it needs saying: failed, stopped by OpenCode, interrupted. */
export function endText(row) {
  if (row.outcome === 'failed') return 'run failed';
  if (row.outcome === 'interrupted') return row.interrupt === 'inactivity' ? 'stopped by OpenCode' : 'interrupted';
  return undefined;
}

/** Why a working row looks stuck: `retrying (2×, rate limited)` or `quiet 14m`; else undefined. */
export function stuckText(row, now) {
  const retry = pendingRetry(row);
  if (retry) return `retrying (${retry.attempt}×, ${retry.message})`;
  const last = lastActivityAt(row);
  return last !== undefined && isQuiet(row, now) ? `quiet ${relativeTime(last, now)}` : undefined;
}

export function activityText(activity) {
  if (!activity) return undefined;
  if (activity.kind !== 'tool') return `${activity.kind}…`;
  return activity.detail ? `${activity.tool ?? 'tool'}: ${activity.detail}` : `running ${activity.tool ?? 'tool'}`;
}

/** First non-empty line of an answer, for a finished row's reason. */
export const answerExcerpt = (answer) => clean(string(answer) ? answer.split('\n').find((l) => l.trim()) : undefined, 200);

/**
 * A row's short reason and its tone: blocked → the request; finished → how it ended, else the
 * answer excerpt when known, else nothing; working → stuck label, else live activity.
 */
export function rowReason(row, now, answer) {
  if (row.state === 'blocked') return { text: askText(row), tone: 'warning' };
  if (row.state === 'finished') {
    const end = endText(row);
    if (end) return { text: end, tone: row.outcome === 'failed' ? 'error' : 'warning' };
    const excerpt = answerExcerpt(answer);
    return excerpt ? { text: excerpt, tone: 'muted' } : undefined;
  }
  if (row.state === 'working') {
    const stuck = stuckText(row, now);
    return stuck ? { text: stuck, tone: 'error' } : { text: activityText(row.activity) ?? 'working', tone: 'muted' };
  }
  return undefined;
}

/** Still in progress: provisioning the worktree or creating the session. */
export const launchRunning = (launch) => launch.status === 'provisioning' || launch.status === 'creating-session';

const LAUNCH_TEXT = { provisioning: 'provisioning…', 'creating-session': 'starting the session…', ready: 'ready · open session', failed: 'failed' };
export const launchStatusText = (launch) => LAUNCH_TEXT[launch.status];

/**
 * Root rows that just entered a notifiable state, comparing two consecutive live states.
 * `gaps` (default): → blocked because of a subagent (OpenCode's builtin notifications only play a
 * sound for subagents). `all`: also root → blocked and → finished (never a reopen). `off`: none.
 */
export function transitions(previous, next, mode = 'gaps') {
  if (!previous || !next || mode === 'off') return [];
  const result = [];
  for (const row of next.rows.values()) {
    const before = previous.rows.get(row.id)?.state;
    if (row.state === before) continue;
    if (row.state === 'blocked' && (mode === 'all' || row.ownState !== 'blocked')) result.push({ kind: 'blocked', row });
    else if (row.state === 'finished' && mode === 'all' && before !== undefined && before !== 'handled') result.push({ kind: 'finished', row });
  }
  return result;
}

/** One notification text for a batch of transitions (blocked first), or undefined. */
export function notification(live, batch) {
  if (!batch.length) return undefined;
  const blocked = batch.filter((t) => t.kind === 'blocked'), finished = batch.filter((t) => t.kind === 'finished');
  const first = blocked[0] ?? finished[0];
  if (batch.length === 1) return { title: 'Fleet', message: `${rowLabel(live, first.row)} ${first.kind === 'finished' ? 'finished' : 'needs you'}` };
  const parts = [blocked.length && `${blocked.length} ${blocked.length === 1 ? 'needs' : 'need'} you`, finished.length && `${finished.length} finished`].filter(Boolean);
  return { title: 'Fleet', message: `${parts.join(' · ')} — ${rowLabel(live, first.row)}` };
}

const parseTally = (v) => object(v) && ['blocked', 'working', 'finished', 'handled'].every((k) => number(v[k]))
  ? { blocked: v.blocked, working: v.working, finished: v.finished, handled: v.handled } : undefined;

function parseLauncherWorktree(v) {
  if (!object(v) || !string(v.directory) || !optional(v.branch, string) || !optional(v.latestSession, string)) return undefined;
  const pr = object(v.pr) && ['unknown', 'none', 'open', 'merged', 'closed'].includes(v.pr.state)
    ? { state: v.pr.state, number: number(v.pr.number) ? v.pr.number : undefined } : undefined;
  return { directory: v.directory, branch: clean(v.branch, 120), owner: v.owner === 'dotfiles' ? 'dotfiles' : 'other', pr, sessions: parseTally(v.sessions), latestSession: v.latestSession };
}

/** `GET /api/fleet/launcher` body (`LauncherList`) → entries, or undefined. Bad entries are dropped. */
export function parseLauncher(v) {
  if (!object(v) || !Array.isArray(v.entries)) return undefined;
  return v.entries.flatMap((e) => {
    if (!object(e) || !string(e.name) || !string(e.directory) || !Array.isArray(e.worktrees) || !optional(e.latestSession, string)) return [];
    return [{ name: clean(e.name, 80), directory: e.directory, sessions: parseTally(e.sessions), latestSession: e.latestSession, worktrees: list(e.worktrees, parseLauncherWorktree) }];
  });
}

/** A worktree's name in the launcher: its branch, else its folder (detached). */
export const worktreeName = (w) => w.branch || lastSegment(w.directory);

const tallyText = (t) => t ? ['blocked', 'finished', 'working'].filter((k) => t[k] > 0).map((k) => `${t[k]} ${k}`).join(' · ') : '';
const prText = (pr) => !pr || ['unknown', 'none'].includes(pr.state) ? '' : `${pr.number !== undefined ? `#${pr.number} ` : ''}${pr.state}`;

/**
 * Launcher dialog options, one category per repository in Fleet's order (most recent agent
 * activity first): the repository, its worktrees, then `+ New worktree in <repo>…`. The dialog's
 * fuzzy filter matches titles and categories, so typing a repo name keeps all of its rows.
 */
export function launcherOptions(entries, formatPath = (p) => p) {
  return entries.flatMap((entry) => [
    { title: entry.name, category: entry.name, description: [formatPath(entry.directory), tallyText(entry.sessions)].filter(Boolean).join(' · '),
      value: { kind: 'open', directory: entry.directory, latestSession: entry.latestSession, name: entry.name } },
    ...entry.worktrees.map((w) => ({
      title: `${entry.name} · ${worktreeName(w)}`, category: entry.name,
      description: [w.owner === 'dotfiles' ? undefined : 'pi', prText(w.pr), tallyText(w.sessions)].filter(Boolean).join(' · ') || formatPath(w.directory),
      value: { kind: 'open', directory: w.directory, latestSession: w.latestSession, name: `${entry.name} · ${worktreeName(w)}` },
    })),
    { title: `+ New worktree in ${entry.name}…`, category: entry.name, value: { kind: 'new', repoDir: entry.directory, repoName: entry.name } },
  ]);
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

/**
 * Default bindings, all on leader keys OpenCode 2.0.20 leaves unbound (`config/keybind.ts`):
 * `<leader>n` is session.new and `<leader>u` session.undo, hence `o` and `z`.
 */
export const DEFAULT_KEYS = { open: '<leader>f', next: '<leader>j', launcher: '<leader>o', handled: '<leader>h', undo: '<leader>z' };

/** Plugin option `keys` over the defaults: non-empty strings only; `false` unbinds. */
export function resolveKeys(option) {
  const keys = { ...DEFAULT_KEYS };
  if (!object(option)) return keys;
  for (const name of Object.keys(DEFAULT_KEYS)) {
    const value = option[name];
    if (value === false) keys[name] = false;
    else if (string(value) && value.trim()) keys[name] = value.trim();
  }
  return keys;
}
