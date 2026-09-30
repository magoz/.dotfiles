import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyChange, badgeText, badgeView, buildBoard, formatAge, nextNeedsYou, notification, notifyMode, parseChange,
  parseSnapshot, resolveBaseURL, rowDetail, rowLabel, transitions,
} from './fleet.js';
import { NOW, wireRow, wireSnapshot } from './fixtures.js';

test('snapshot → board: state-first sections, newest first, idle only within 24h', () => {
  const live = parseSnapshot(wireSnapshot([
    wireRow('d1', 'done', { updated: NOW - 5_000 }),
    wireRow('w1', 'working', { updated: NOW - 50_000 }),
    wireRow('w2', 'working', { updated: NOW - 10_000, directory: '/wt/feat-x' }),
    wireRow('n1', 'needs-you', { pending: { permissions: 1, forms: 0 } }),
    wireRow('f1', 'failed'),
    wireRow('i1', 'idle', { updated: NOW - 3_600_000 }),
    wireRow('i2', 'idle', { updated: NOW - 2 * 86_400_000 }),
  ]));
  const board = buildBoard(live, NOW);
  assert.deepEqual(board.sections.map((s) => [s.state, s.rows.map((r) => r.id)]), [
    ['needs-you', ['n1']], ['failed', ['f1']], ['working', ['w2', 'w1']], ['done', ['d1']],
  ]);
  assert.deepEqual(board.idle.map((r) => r.id), ['i1']);
  assert.deepEqual(board.counts, { 'needs-you': 1, failed: 1, working: 2, done: 1, idle: 1 });
  assert.equal(badgeText(board.counts), '⚑ 1 needs you · 1 failed · 2 working · 1 done');
  assert.equal(badgeText({ 'needs-you': 2, failed: 0, working: 3, done: 1 }), '⚑ 2 need you · 3 working · 1 done');
  assert.equal(badgeText({ 'needs-you': 0, failed: 0, working: 0, done: 0, idle: 9 }), '');
});

test('badge: hidden without data, when unreachable or all idle; subtle when not live', () => {
  const busy = parseSnapshot(wireSnapshot([wireRow('w', 'working')]));
  const idle = parseSnapshot(wireSnapshot([wireRow('i', 'idle')]));
  assert.equal(badgeView('live', undefined, NOW).visible, false);
  assert.equal(badgeView('unreachable', busy, NOW).visible, false);
  assert.equal(badgeView('live', idle, NOW).visible, false);
  assert.deepEqual([badgeView('live', busy, NOW).visible, badgeView('live', busy, NOW).subtle], [true, false]);
  assert.equal(badgeView('reconnecting', busy, NOW).subtle, true);
  assert.equal(badgeView('live', parseSnapshot(wireSnapshot([wireRow('w', 'working')], 'disconnected')), NOW).subtle, true);
});

test('labels: project · worktree · title; global project uses directory; details', () => {
  const live = parseSnapshot(wireSnapshot([
    wireRow('a', 'working', { directory: '/wt/feat-x', activity: { kind: 'tool', tool: 'bash', detail: 'pnpm test' } }),
    wireRow('b', 'needs-you', { projectID: 'global', directory: '/tmp/scratch', title: undefined, ownState: 'working', pending: { permissions: 0, forms: 2 } }),
    wireRow('c', 'done', { title: 'bad\x1b[31mtitle\nline' }),
  ]));
  assert.equal(rowLabel(live, live.rows.get('a')), 'box · feat-x · T a');
  assert.equal(rowLabel(live, live.rows.get('b')), 'scratch · Untitled');
  assert.equal(live.rows.get('c').title, 'bad [31mtitle line');
  assert.equal(rowDetail(live.rows.get('a'), NOW), 'bash: pnpm test · 1m');
  assert.equal(rowDetail(live.rows.get('b'), NOW), '2 questions (subagent) · 1m');
  assert.equal(rowDetail(live.rows.get('c'), NOW), '1m');
  assert.deepEqual([formatAge(1000), formatAge(45_000), formatAge(7_200_000), formatAge(3 * 86_400_000)], ['now', '45s', '2h', '3d']);
});

test('defensive parsing: bad shapes rejected, bad rows dropped', () => {
  for (const bad of [null, [], {}, { projects: 'x' }, 'text']) assert.equal(parseSnapshot(bad), undefined);
  const live = parseSnapshot({ projects: [{ id: 'p1', directory: '/r', worktrees: [{ directory: '/r', kind: 'root', rows: [
    wireRow('ok', 'working', { directory: '/r' }), { id: 'x', state: 'bogus' }, null, wireRow('', 'done'),
    wireRow('bad-web', 'done', { directory: '/r', links: { web: 'javascript:alert(1)' } }),
  ] }] }, 'junk'] });
  assert.deepEqual([...live.rows.keys()], ['ok', 'bad-web']);
  assert.equal(live.rows.get('bad-web').web, undefined);
  assert.equal(live.connection, 'disconnected');
  assert.equal(parseChange({ initial: true }), undefined);
  assert.deepEqual(parseChange({ initial: false, rows: [{}], removed: ['a', 3] }), { initial: false, connection: 'disconnected', rows: [], removed: ['a'] });
});

test('applyChange updates/removes rows and flags unknown projects', () => {
  const live = parseSnapshot(wireSnapshot([wireRow('a', 'working'), wireRow('b', 'idle')]));
  const { live: next, stale } = applyChange(live, parseChange({ initial: false, connection: { status: 'connected' },
    rows: [wireRow('a', 'done')], removed: ['b'] }));
  assert.deepEqual([...next.rows.values()].map((r) => [r.id, r.state]), [['a', 'done']]);
  assert.equal(stale, false);
  assert.equal(applyChange(live, parseChange({ initial: false, rows: [wireRow('z', 'done', { projectID: 'new' })], removed: [] })).stale, true);
  assert.equal(live.rows.get('a').state, 'working');
});

test('transitions: gaps notifies only subagent needs-you; all adds root needs-you and done; never new done rows', () => {
  const before = parseSnapshot(wireSnapshot([wireRow('a', 'working'), wireRow('b', 'working'), wireRow('c', 'working'), wireRow('n', 'needs-you')]));
  const after = parseSnapshot(wireSnapshot([
    wireRow('a', 'needs-you', { ownState: 'working' }), wireRow('b', 'needs-you'), wireRow('c', 'done'),
    wireRow('n', 'needs-you', { ownState: 'working' }), wireRow('new', 'done'),
  ]));
  const ids = (list) => list.map((t) => `${t.kind}:${t.row.id}`);
  assert.deepEqual(ids(transitions(before, after, 'gaps')), ['needs-you:a']);
  assert.deepEqual(ids(transitions(before, after, 'all')), ['needs-you:a', 'needs-you:b', 'done:c']);
  assert.deepEqual(transitions(before, after, 'off'), []);
  assert.deepEqual(transitions(undefined, after, 'all'), []);
  assert.equal(notifyMode('bogus'), 'gaps');
  assert.deepEqual(notification(after, transitions(before, after, 'gaps')), { title: 'Fleet', message: 'box · T a needs you' });
  assert.deepEqual(notification(after, transitions(before, after, 'all')), { title: 'Fleet', message: '2 need you · 1 done — box · T a' });
});

test('next needs-you cycles in board order from the current root', () => {
  const live = parseSnapshot(wireSnapshot([
    wireRow('old', 'needs-you', { updated: NOW - 90_000 }), wireRow('new', 'needs-you', { updated: NOW - 1_000 }), wireRow('w', 'working'),
  ]));
  const board = buildBoard(live, NOW);
  assert.equal(nextNeedsYou(board, undefined).id, 'new');
  assert.equal(nextNeedsYou(board, 'new').id, 'old');
  assert.equal(nextNeedsYou(board, 'old').id, 'new');
  assert.equal(nextNeedsYou(buildBoard(parseSnapshot(wireSnapshot([wireRow('w', 'working')])), NOW), undefined), undefined);
});

test('base URL: option, then env, then default; rejects credentials and non-http', () => {
  assert.equal(resolveBaseURL(undefined, undefined), 'https://fleet.oox.sh');
  assert.equal(resolveBaseURL('https://a.example/', 'https://b.example'), 'https://a.example');
  assert.equal(resolveBaseURL(undefined, 'http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  assert.equal(resolveBaseURL('https://user:pw@a.example', 'file:///etc'), 'https://fleet.oox.sh');
});
