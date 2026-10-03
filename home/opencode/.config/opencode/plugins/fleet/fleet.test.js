import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_KEYS, QUIET_AFTER, applyChange, askKind, askText, badgeText, badgeView, buildBoard, countRows, isStuck, launcherOptions,
  nextNeedsMe, notification, notifyMode, parseChange, parseLauncher, parseRow, parseSnapshot, relativeTime, resolveBaseURL,
  resolveKeys, rowLabel, rowReason, transitions, withOverrides,
} from './fleet.js';
import { NOW, payloads, realRow, wireLaunch, wireRow, wireSnapshot } from './fixtures.js';

const minute = 60_000;
const ids = (rows) => rows.map((r) => r.id);

test('real Fleet payloads validate: every row, child, launch and the launcher list', () => {
  const live = parseSnapshot(payloads.snapshot);
  const wire = payloads.snapshot.projects.flatMap((p) => p.worktrees.flatMap((w) => w.rows));
  assert.equal(live.rows.size, wire.length);
  assert.equal(live.connection, 'connected');
  assert.deepEqual(live.launches.map((l) => [l.id, l.status]), [['launch-1', 'provisioning'], ['launch-2', 'failed'], ['launch-3', 'ready']]);
  const sub = live.rows.get('ses_wait_sub');
  assert.deepEqual([sub.state, sub.ownState, sub.children.length, sub.children[0].agent, sub.children[0].forms[0].title], ['blocked', 'working', 1, 'explore', 'Which database?']);
  assert.equal(live.rows.get('ses_gone').gone, true);
  assert.equal(live.rows.get('ses_done_stop').interrupt, 'inactivity');
  assert.equal(live.rows.get('ses_retry').retry.message, 'rate limited');
  assert.match(live.rows.get('ses_busy').web, /^https:\/\//);
  const change = parseChange(payloads.change);
  assert.deepEqual([ids(change.rows), change.removed, change.launches.length], [['ses_busy'], ['ses_tmp'], 3]);
  assert.deepEqual(parseLauncher(payloads.launcher).map((e) => [e.name, e.worktrees.length]), [['fleet', 2], ['box', 0], ['anvil', 0]]);
});

test('ordering mirrors Fleet: blocked longest wait first, then finished oldest first; working stuck first, then newest', () => {
  const board = buildBoard(parseSnapshot(payloads.snapshot), NOW);
  assert.deepEqual(ids(board.blocked), ['ses_wait_old', 'ses_wait_new', 'ses_wait_sub']);
  assert.deepEqual(ids(board.finished), ['ses_done_old', 'ses_done_stop', 'ses_done_new', 'ses_tmp']);
  assert.deepEqual(ids(board.needsMe), [...ids(board.blocked), ...ids(board.finished)]);
  assert.deepEqual(ids(board.working), ['ses_quiet', 'ses_retry', 'ses_busy']);
  assert.deepEqual(board.counts, payloads.snapshot.counts);
  assert.deepEqual(board.counts, { blocked: 3, finished: 4, working: 3, stuck: 2, handled: 3 });
});

test('quiet after 10 minutes of no activity in the running subtree; a busy subagent keeps its parent un-stuck', () => {
  const at = (ms) => wireRow('w', 'working', { activityAt: NOW - ms });
  assert.equal(isStuck(at(QUIET_AFTER - 1000), NOW), false);
  assert.equal(isStuck(at(QUIET_AFTER), NOW), true);
  const child = { ...realRow('ses_wait_sub').children[0], running: true, activityAt: NOW - minute };
  const parsed = parseRow({ ...at(QUIET_AFTER * 2), children: [child] });
  assert.equal(isStuck(parsed, NOW), false);
  assert.equal(rowReason(parseRow(at(15 * minute)), NOW).text, 'quiet 15m');
  assert.deepEqual(countRows([parseRow(at(QUIET_AFTER)), parseRow(wireRow('f', 'finished'))], NOW), { blocked: 0, finished: 1, working: 1, stuck: 1, handled: 0 });
});

test('badge: need you / working / stuck, non-zero parts only; hidden when unreachable or nothing happens', () => {
  assert.equal(badgeText({ blocked: 3, finished: 4, working: 3, stuck: 2, handled: 9 }), '⚑ 7 need you · 3 working · 2 stuck');
  assert.equal(badgeText({ blocked: 1, finished: 0, working: 0, stuck: 0, handled: 0 }), '⚑ 1 needs you');
  assert.equal(badgeText({ blocked: 0, finished: 0, working: 2, stuck: 0, handled: 5 }), '⚑ 2 working');
  assert.equal(badgeText({ blocked: 0, finished: 0, working: 0, stuck: 0, handled: 5 }), '');
  const busy = parseSnapshot(wireSnapshot([wireRow('w', 'working')]));
  const quiet = parseSnapshot(wireSnapshot([wireRow('h', 'handled')]));
  assert.equal(badgeView('live', undefined, NOW).visible, false);
  assert.equal(badgeView('unreachable', busy, NOW).visible, false);
  assert.equal(badgeView('live', quiet, NOW).visible, false);
  assert.deepEqual([badgeView('live', busy, NOW).visible, badgeView('live', busy, NOW).subtle], [true, false]);
  assert.equal(badgeView('reconnecting', busy, NOW).subtle, true);
  assert.equal(badgeView('live', parseSnapshot(wireSnapshot([wireRow('w', 'working')], 'disconnected')), NOW).subtle, true);
  assert.equal(badgeView('live', parseSnapshot(payloads.snapshot), NOW).text, '⚑ 7 need you · 3 working · 2 stuck');
});

test('reasons: request summary (own, then subagent, +more), how the run ended, answer excerpt, stuck', () => {
  const live = parseSnapshot(payloads.snapshot);
  const reason = (id, answer) => rowReason(live.rows.get(id), NOW, answer)?.text;
  assert.equal(reason('ses_wait_old'), 'bash: pnpm db:push');
  assert.equal(reason('ses_wait_new'), 'Ship it?');
  assert.equal(reason('ses_wait_sub'), 'explore asks: Which database?');
  assert.equal(reason('ses_done_old'), 'run failed');
  assert.equal(reason('ses_done_stop'), 'stopped by OpenCode');
  assert.equal(reason('ses_done_new'), undefined);
  assert.equal(reason('ses_done_new', '\n Added the palette.\nAll tests pass.'), 'Added the palette.');
  assert.equal(reason('ses_retry'), 'retrying (2×, rate limited)');
  assert.equal(reason('ses_busy'), 'bash: pnpm test');
  const two = parseRow(wireRow('b', 'blocked', { pending: { permissions: 2, forms: 1 }, permissions: [{ id: 'p', sessionID: 'b', action: 'edit', resources: [] }] }));
  assert.equal(askText(two), 'edit (+2)');
  assert.equal(askText(parseRow(wireRow('c', 'blocked', { pending: { permissions: 0, forms: 2 } }))), '2 questions');
  // The sidebar marker follows the request shown: `!` a permission, `?` a question (own or a subagent's).
  assert.deepEqual(['ses_wait_old', 'ses_wait_new', 'ses_wait_sub'].map((id) => askKind(live.rows.get(id))), ['permission', 'question', 'question']);
  assert.equal(askKind(two), 'permission');
  assert.deepEqual([{ permissions: 1, forms: 0 }, { permissions: 0, forms: 1 }].map((pending) => askKind(parseRow(wireRow('d', 'blocked', { pending })))), ['permission', 'question']);
  // Reason tones: base for asks and stops, red for failures and stuck; never the warning colour.
  assert.deepEqual(['ses_wait_old', 'ses_done_old', 'ses_done_stop', 'ses_retry', 'ses_busy'].map((id) => rowReason(live.rows.get(id), NOW).tone),
    ['base', 'error', 'base', 'error', 'muted']);
  assert.deepEqual([relativeTime(NOW - 30_000, NOW), relativeTime(NOW - 5 * minute, NOW), relativeTime(NOW - 3 * 3_600_000, NOW), relativeTime(NOW - 2 * 86_400_000, NOW)], ['now', '5m', '3h', '2d']);
});

test('labels: project · worktree · title; global project uses the directory', () => {
  const live = parseSnapshot(payloads.snapshot);
  assert.equal(rowLabel(live, live.rows.get('ses_done_new')), 'fleet · fleet-feat-x · Done new');
  assert.equal(rowLabel(live, live.rows.get('ses_done_old')), 'fleet · Done old');
  assert.equal(rowLabel(live, live.rows.get('ses_tmp')), 'scratch · Scratch');
  const odd = parseSnapshot(wireSnapshot([wireRow('c', 'finished', { title: 'bad\x1b[31mtitle\nline' })]));
  assert.equal(odd.rows.get('c').title, 'bad [31mtitle line');
});

test('strict shapes: old or bad rows, children and launches are dropped, not fatal', () => {
  for (const bad of [null, [], {}, { projects: 'x' }, 'text']) assert.equal(parseSnapshot(bad), undefined);
  const { activeAt, gone, ...noActiveAt } = wireRow('x1', 'finished');
  const oldShape = { id: 'old', projectID: 'p1', directory: '/repo', state: 'needs-you', ownState: 'needs-you', updated: NOW, running: false, permissions: [], forms: [] };
  const badChild = wireRow('kid', 'finished', { children: [{ id: 'c', state: 'bogus' }, realRow('ses_wait_sub').children[0]] });
  const live = parseSnapshot(wireSnapshot([
    wireRow('ok', 'working'), noActiveAt, { ...noActiveAt, id: 'x2', activeAt }, oldShape, badChild,
    wireRow('bad-web', 'finished', { links: { web: 'javascript:alert(1)', terminal: '', command: '' } }),
    wireRow('bad-outcome', 'finished', { outcome: 'exploded' }), wireRow('', 'finished'), { ...wireRow('no-gone', 'finished'), gone: undefined },
  ], 'connected', [wireLaunch(), { ...wireLaunch({ id: 'bad' }), status: 'queued' }, null]));
  assert.equal(gone, false);
  assert.deepEqual([...live.rows.keys()].sort(), ['bad-web', 'kid', 'ok']);
  assert.equal(live.rows.get('bad-web').web, undefined);
  assert.deepEqual(ids(live.rows.get('kid').children), ['ses_wait_sub_child']);
  assert.deepEqual(ids(live.launches), ['launch-1']);
  assert.equal(parseSnapshot({ projects: [] }).connection, 'disconnected');
  assert.deepEqual(parseSnapshot({ projects: [] }).launches, []);
  assert.equal(parseChange({ initial: true }), undefined);
  assert.deepEqual(parseChange({ initial: false, rows: [{}], removed: ['a', 3] }), { initial: false, connection: 'disconnected', rows: [], removed: ['a'], launches: undefined });
});

test('applyChange updates/removes rows, replaces launches only when sent, flags unknown projects', () => {
  const live = parseSnapshot(wireSnapshot([wireRow('a', 'working'), wireRow('b', 'handled')], 'connected', [wireLaunch()]));
  const { live: next, stale } = applyChange(live, parseChange({ initial: false, connection: { status: 'connected' }, rows: [wireRow('a', 'finished')], removed: ['b'] }));
  assert.deepEqual([...next.rows.values()].map((r) => [r.id, r.state]), [['a', 'finished']]);
  assert.equal(next.launches, live.launches);
  assert.equal(stale, false);
  const ready = applyChange(next, parseChange({ initial: false, rows: [], removed: [], launches: [wireLaunch({ status: 'ready', sessionID: 's' })] })).live;
  assert.deepEqual(ready.launches.map((l) => l.status), ['ready']);
  assert.equal(applyChange(live, parseChange({ initial: false, rows: [wireRow('z', 'finished', { projectID: 'new' })], removed: [] })).stale, true);
  assert.equal(live.rows.get('a').state, 'working');
});

test('optimistic overrides hold until the server sends anything new for the row', () => {
  const live = parseSnapshot(wireSnapshot([wireRow('f', 'finished'), wireRow('h', 'handled', { handled: NOW - minute })]));
  const f = live.rows.get('f'), h = live.rows.get('h');
  const shown = withOverrides(live, new Map([['f', { base: f, target: 'handled' }], ['h', { base: h, target: 'finished' }]]));
  assert.deepEqual([shown.rows.get('f').state, shown.rows.get('h').state], ['handled', 'finished']);
  assert.equal(buildBoard(shown, NOW).counts.finished, 1);
  const fresh = applyChange(live, parseChange({ initial: false, rows: [wireRow('f', 'finished')], removed: [] })).live;
  assert.equal(withOverrides(fresh, new Map([['f', { base: f, target: 'handled' }]])).rows.get('f').state, 'finished');
  assert.equal(withOverrides(live, new Map()), live);
});

test('notifications: gaps = → blocked from a subagent; all adds root → blocked and → finished (never a reopen)', () => {
  const before = parseSnapshot(wireSnapshot([wireRow('a', 'working'), wireRow('b', 'working'), wireRow('c', 'working'), wireRow('n', 'blocked'), wireRow('r', 'handled')]));
  const after = parseSnapshot(wireSnapshot([
    wireRow('a', 'blocked', { ownState: 'working' }), wireRow('b', 'blocked'), wireRow('c', 'finished'),
    wireRow('n', 'blocked', { ownState: 'working' }), wireRow('r', 'finished'), wireRow('new', 'finished'),
  ]));
  const kinds = (list) => list.map((t) => `${t.kind}:${t.row.id}`);
  assert.deepEqual(kinds(transitions(before, after, 'gaps')), ['blocked:a']);
  assert.deepEqual(kinds(transitions(before, after, 'all')), ['blocked:a', 'blocked:b', 'finished:c']);
  assert.deepEqual(transitions(before, after, 'off'), []);
  assert.deepEqual(transitions(undefined, after, 'all'), []);
  assert.equal(notifyMode('bogus'), 'gaps');
  assert.deepEqual(notification(after, transitions(before, after, 'gaps')), { title: 'Fleet', message: 'box · T a needs you' });
  assert.deepEqual(notification(after, transitions(before, after, 'all')), { title: 'Fleet', message: '2 need you · 1 finished — box · T a' });
});

test('next needs-me follows the list order from the current root, wrapping', () => {
  const order = buildBoard(parseSnapshot(payloads.snapshot), NOW).needsMe;
  assert.equal(nextNeedsMe(order, undefined).id, 'ses_wait_old');
  assert.equal(nextNeedsMe(order, 'ses_busy').id, 'ses_wait_old');
  assert.equal(nextNeedsMe(order, 'ses_wait_sub').id, 'ses_done_old');
  assert.equal(nextNeedsMe(order, 'ses_tmp').id, 'ses_wait_old');
  assert.equal(nextNeedsMe([], 'x'), undefined);
});

test('launcher options: one category per repo in Fleet order, worktrees, then + New worktree', () => {
  const options = launcherOptions(parseLauncher(payloads.launcher));
  assert.deepEqual(options.slice(0, 4).map((o) => [o.category, o.title, o.description]), [
    ['fleet', 'fleet', '/home/magoz/dev/repos/fleet · 2 blocked · 2 finished · 2 working'],
    ['fleet', 'fleet · feat/x', '#7 open · 1 blocked · 1 finished · 1 working'],
    ['fleet', 'fleet · pi/thing', 'pi · #3 closed'],
    ['fleet', '+ New worktree in fleet…', undefined],
  ]);
  assert.deepEqual(options[1].value, { kind: 'open', directory: '/home/magoz/dev/repos/fleet-feat-x', latestSession: 'ses_retry', name: 'fleet · feat/x' });
  assert.deepEqual(options[3].value, { kind: 'new', repoDir: '/home/magoz/dev/repos/fleet', repoName: 'fleet' });
  assert.deepEqual(options.map((o) => o.category).filter((c, i, all) => all.indexOf(c) === i), ['fleet', 'box', 'anvil']);
  assert.equal(parseLauncher({ entries: 'x' }), undefined);
});

test('base URL, keys and notify options', () => {
  assert.equal(resolveBaseURL(undefined, undefined), 'https://fleet.oox.sh');
  assert.equal(resolveBaseURL('https://a.example/', 'https://b.example'), 'https://a.example');
  assert.equal(resolveBaseURL(undefined, 'http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  assert.equal(resolveBaseURL('https://user:pw@a.example', 'file:///etc'), 'https://fleet.oox.sh');
  assert.deepEqual(DEFAULT_KEYS, { open: '<leader>f', next: '<leader>j', launcher: '<leader>o', handled: '<leader>h', undo: '<leader>z' });
  assert.deepEqual(resolveKeys({ launcher: ' <leader>p ', undo: false, handled: '', next: 3 }), { ...DEFAULT_KEYS, launcher: '<leader>p', undo: false });
  assert.deepEqual(resolveKeys('x'), DEFAULT_KEYS);
});
