import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adapt, body } from './server.js';
const ids = JSON.parse(await readFile(new URL('./sources.json', import.meta.url)));
const sharedRoot = new URL('../../../../../agents/.agents/skills/', import.meta.url);
assert.ok(Array.isArray(ids) && ids.length > 0, 'sources.json is an id allowlist');
for (const id of ids) test(`canonical ${id} gets the OpenCode-only overlay without digest pinning`, async () => {
  const source = await readFile(new URL(`${id}/SKILL.md`, sharedRoot), 'utf8');
  const content = body(source);
  const skill = { id, location: `/shared/${id}/SKILL.md`, content };
  const result = adapt(skill, ids, ['/shared']);
  assert.match(result.content, /OpenCode assessment runtime adapter/);
  assert.match(result.content, /native subagent/);
  assert.match(result.content, /source TUI/);
  assert.equal(skill.content, content);
  assert.equal(adapt({ ...skill, location: `/project/${id}/SKILL.md` }, ids, ['/shared']), undefined);
  // Canonical drift adapts instead of blocking; unlisted ids pass through untouched.
  const changed = adapt({ ...skill, content: content + '\nchanged' }, ids, ['/shared']);
  assert.match(changed.content, /OpenCode assessment runtime adapter/);
  assert.ok(changed.content.endsWith('changed'));
  assert.equal(adapt({ ...skill, id: 'unlisted' }, ids, ['/shared']), undefined);
});

test('current pr review-delivery wording maps to the native inline transport', async () => {
  const source = await readFile(new URL('pr/SKILL.md', sharedRoot), 'utf8');
  const adapted = adapt({ id: 'pr', location: '/shared/pr/SKILL.md', content: body(source) }, ids, ['/shared']);
  assert.match(adapted.content, /Pass the COMPLETE frozen bundle INLINE through native `subagent\.prompt`/);
  assert.doesNotMatch(adapted.content, /Pass the frozen bundle and relevant audit-only skills to\s+both,/);
});
