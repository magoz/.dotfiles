import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceAfterTick, coalescePastDue, formatDuration, initialFacts, messageID, parseCommand, receipt, receiptText,
  recurringWake, startedText, terminalWake, toolInput, TOOL_DESCRIPTION,
} from '../domain.js';

const context = { cwd: '/repo', now: 1000, isDirectory: (dir) => ['/repo', '/repo/sub', '/tmp'].includes(dir) };

test('start parses pi-until parameters with defaults; cwd resolves from the session directory', () => {
  const { definition } = parseCommand({ action: 'start', condition: ' test -f done ' }, context);
  assert.deepEqual(definition, {
    kind: 'until', label: 'condition', wake: 'agent', intervalMs: 30000,
    gate: { command: 'test -f done', cwd: '/repo', checkTimeoutMs: 30000 },
  });
  const full = parseCommand({ action: 'start', condition: 'true', label: 'deploy', cwd: 'sub', intervalSeconds: 5, checkTimeoutSeconds: 2, timeoutSeconds: 60, wake: 'notify' }, context).definition;
  assert.equal(full.gate.cwd, '/repo/sub'); assert.equal(full.intervalMs, 5000); assert.equal(full.gate.checkTimeoutMs, 2000);
  assert.equal(full.expiresAt, 61000); assert.equal(full.wake, 'notify'); assert.equal(full.label, 'deploy');
});

test('parse errors say exactly what to fix', () => {
  const cases = [
    [{ action: 'start' }, /condition is required/],
    [{ action: 'start', condition: 'x', cwd: 'missing' }, /cwd is not a directory: \/repo\/missing/],
    [{ action: 'start', condition: 'x', intervalSeconds: 0 }, /intervalSeconds must be a number from 1/],
    [{ action: 'start', condition: 'x'.repeat(4097) }, /condition must be at most 4096/],
    [{ action: 'repeat', instruction: 'x', quickRef: 'y' }, /timeoutSeconds is required/],
    [{ action: 'repeat', quickRef: 'y', timeoutSeconds: 9 }, /instruction is required/],
    [{ action: 'repeat', instruction: 'x', quickRef: 'y', timeoutSeconds: 9, wake: 'notify' }, /repeat always wakes the agent/],
    [{ action: 'cancel' }, /id is required/],
    [{ action: 'nope' }, /action must be one of/],
  ];
  for (const [input, error] of cases) assert.throws(() => parseCommand(input, context), error, JSON.stringify(input));
});

test('like pi-until, fields an action does not use are ignored and null means absent', () => {
  assert.deepEqual(parseCommand({ action: 'cancel', id: 'w1', label: 'x', condition: 'y' }, context), { action: 'cancel', id: 'w1' });
  assert.deepEqual(parseCommand({ action: 'list', id: 'w1' }, context), { action: 'list' });
  const { definition } = parseCommand({ action: 'start', condition: 'true', cwd: null, timeoutSeconds: null, instruction: 'ignored' }, context);
  assert.equal(definition.gate.cwd, '/repo'); assert.equal(definition.expiresAt, undefined);
});

test('repeat snapshots the task, gate optional; immediate controls the first wake', () => {
  const { definition } = parseCommand({
    action: 'repeat', instruction: 'Review deploy', quickRef: 'Release 42', timeoutSeconds: 3600, intervalSeconds: 600,
    contextRefs: [{ label: 'Runbook', target: 'docs/release.md' }], immediate: true,
  }, context);
  assert.equal(definition.kind, 'recurring'); assert.equal(definition.gate, undefined); assert.equal(definition.first, 'now');
  assert.equal(definition.expiresAt, 3601000); assert.deepEqual(definition.snapshot.contextRefs, [{ label: 'Runbook', target: 'docs/release.md' }]);
  assert.equal(initialFacts(definition, 1000).nextDueAt, 1000);
  assert.equal(initialFacts({ ...definition, first: 'afterInterval' }, 1000).nextDueAt, 601000);
});

test('cadence stays anchored; ticks that pass during work become missed, never stacked', () => {
  const facts = { nextDueAt: 1000, missedTicks: 0 };
  assert.deepEqual(advanceAfterTick(facts, 100, 1000), { nextDueAt: 1100, missedTicks: 0 });
  assert.deepEqual(advanceAfterTick(facts, 100, 1350), { nextDueAt: 1400, missedTicks: 3 });
  assert.deepEqual(coalescePastDue({ nextDueAt: 1100, missedTicks: 0 }, 100, 1250), { nextDueAt: 1300, missedTicks: 2 });
  assert.deepEqual(coalescePastDue({ nextDueAt: 1100, missedTicks: 0 }, 100, 1050), { nextDueAt: 1100, missedTicks: 0 });
});

test('message IDs use OpenCode ascending format', () => {
  const a = messageID(1_700_000_000_000), b = messageID(1_700_000_000_000), c = messageID(1_700_000_000_001);
  for (const id of [a, b, c]) assert.match(id, /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  assert.ok(a.slice(4, 16) < b.slice(4, 16) && b.slice(4, 16) < c.slice(4, 16));
});

const watch = (definition, facts) => ({ id: 'abcd1234', sessionID: 'ses', definition, facts: { ...initialFacts(definition, 0), ...facts } });

test('wakes: success tells the agent to verify before acting; notify wakes nobody', () => {
  const definition = parseCommand({ action: 'start', condition: 'test -f done', label: 'build' }, context).definition;
  const wake = terminalWake(watch(definition, { status: 'succeeded', attempts: 3, finishedAt: 134000 }), 134000);
  assert.match(wake.text, /^The condition was true when checked\. Before acting, confirm/);
  assert.match(wake.text, /until watch abcd1234: succeeded\nKind: until\nLabel: build\nCondition: test -f done/);
  assert.equal(wake.description, 'until · build · condition met after 3 checks (2m14s)');
  assert.match(terminalWake(watch(definition, { status: 'timedOut', attempts: 1, finishedAt: 5 }), 5).text, /timed out/);
  assert.equal(terminalWake(watch(definition, { status: 'cancelled', finishedAt: 5 }), 5), undefined);
  assert.equal(terminalWake(watch({ ...definition, wake: 'notify' }, { status: 'succeeded', finishedAt: 5 }), 5), undefined);
});

test('recurring packets carry instruction, receipt, context and control lines', () => {
  const definition = parseCommand({ action: 'repeat', instruction: 'Fix failures', quickRef: 'Release 42', timeoutSeconds: 60, contextRefs: [{ label: 'Runbook', target: 'docs/r.md' }] }, { ...context, now: 0 }).definition;
  const tick = recurringWake(watch(definition, { deliveries: 2, missedTicks: 1, nextDueAt: 90000 }), 30000);
  assert.match(tick.text, /# Recurring follow-up\n\n## Instruction\nFix failures\n\n## Quick reference\nRelease 42/);
  assert.match(tick.text, /- Delivery: 2\n- Missed ticks: 1/);
  assert.match(tick.text, /- Runbook: `docs\/r.md`/);
  assert.match(tick.text, /action=complete` and `id=abcd1234`/);
  assert.equal(tick.description, 'until · recurring follow-up · wake 2 (1 missed)');
  const expired = terminalWake(watch(definition, { status: 'expired', deliveries: 4, finishedAt: 60000 }), 60000);
  assert.match(expired.text, /Do not continue its task unless the user asks/);
  assert.equal(terminalWake(watch(definition, { status: 'completed', finishedAt: 5 }), 5), undefined);
});

test('receipts and started text are agent-actionable', () => {
  const definition = parseCommand({ action: 'start', condition: 'true', timeoutSeconds: 60 }, context).definition;
  const r = receipt(watch(definition, { lastResult: { code: 124, killed: true }, attempts: 2 }), 5000);
  assert.match(receiptText(r), /Last exit code: 124\nLast check ran past checkTimeoutSeconds/);
  assert.match(startedText(watch(definition, {})), /Checks now, then every 30s, until .*do not poll\./);
  assert.equal(formatDuration(3_725_000), '1h02m');
});

test('tool contract: one direct schema, pi-until names, guidance in the description', () => {
  assert.deepEqual(Object.keys(toolInput.properties).sort(), ['action', 'checkTimeoutSeconds', 'condition', 'contextRefs', 'cwd', 'id', 'immediate', 'instruction', 'intervalSeconds', 'label', 'quickRef', 'timeoutSeconds', 'wake']);
  assert.equal(toolInput.additionalProperties, false);
  for (const phrase of ['Never block a turn', 'fail-closed', 'Run list before re-arming', 'survive Esc', 'Requires instruction, quickRef and timeoutSeconds', 'In a subagent, watches belong to the main session']) assert.ok(TOOL_DESCRIPTION.includes(phrase), phrase);
});
