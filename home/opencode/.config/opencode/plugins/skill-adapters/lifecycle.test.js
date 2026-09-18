import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import plugin, { body } from './server.js';

test('late native config.skill loading, prompt/tool boundaries and persisted-skill context', async () => {
  const transforms = new Set(), hooks = new Map();
  let content = body(await readFile(new URL('../../../../../agents/.agents/skills/pr/SKILL.md', import.meta.url), 'utf8'));
  const register = (domain) => async (name, callback) => {
    const key = domain + ':' + name; hooks.set(key, callback);
    return { async dispose() { hooks.delete(key); } };
  };
  const ctx = {
    skill: {
      async transform(callback) { const entry = { callback }; transforms.add(entry); return { async dispose() { transforms.delete(entry); } }; },
      async list() {
        const items = new Map();
        const editor = { list: () => [...items.values()], add: (s) => items.set(s.id, { ...s }), update: (id, fn) => fn(items.get(id)) };
        for (const transform of transforms) transform.callback(editor);
        return { data: editor.list() };
      },
    },
    session: { hook: register('session') }, tool: { hook: register('tool') }, event: { async *subscribe() {} },
  };
  const cleanup = await plugin.setup(ctx);
  const native = await ctx.skill.transform((editor) => editor.add({ id: 'pr', location: path.join(homedir(), '.agents/skills/pr/SKILL.md'), content }));
  try {
    assert.equal((await ctx.skill.list()).data[0].content, content);
    await hooks.get('session:prompt')();
    assert.match((await ctx.skill.list()).data[0].content, /^# OpenCode assessment/);
    await hooks.get('tool:execute.before')({ tool: 'skill' });
    content += '\nPolicy changed';
    const context = { system: [] };
    await hooks.get('session:context')(context);
    assert.match(context.system[0].text, /single implementation writer/);
    assert.doesNotMatch(context.system[0].text, /stale/);
    // Drifted canonical content re-adapts instead of blocking.
    const adapted = (await ctx.skill.list()).data[0].content;
    assert.match(adapted, /^# OpenCode assessment/);
    assert.match(adapted, /Policy changed/);
  } finally { await cleanup(); await native.dispose(); }
  assert.equal(transforms.size, 0); assert.equal(hooks.size, 0);
});
