import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { assertChildReads } from './permissions.mjs';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const config = JSON.parse((await read('opencode.jsonc')).replace(/^\s*\/\/.*$/gm, ''));
test('OpenCode assessment uses native compaction/models and explicit shared skill precedence', () => {
  assert.equal(config.compaction.auto, true);
  assert.equal(config.model, 'openai/gpt-6-astra');
  assert.equal(config.agents.build.model, 'openai/gpt-6-astra#high');
  assert.equal(config.agents.build.system, undefined);
  assert.equal(config.skills[0], '~/.config/opencode/shared-skills');
  assert.ok(!JSON.stringify(config).includes('/Users/'));
});
test('server and TUI integration entrypoints exist; pinned V2 Herdr assets', async () => {
  for (const target of config.plugins) {
    await access(new URL(`${target}/server.js`, root)).catch(async () => {
      assert.equal(target, './plugins/opencode-anthropic-auth');
      await access(new URL(`${target}/index.mjs`, root));
    });
  }
  const cli = JSON.parse(await read('cli.json'));
  for (const entry of cli.plugins) await access(new URL(`${entry.package}/tui.js`, root));
  assert.match(await read('plugins/herdr-opencode/tui.js'), /HERDR_INTEGRATION_VERSION=12/);
  assert.match(await read('plugins/herdr-opencode/server.js'), /setup\(\) \{\}/);
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.dependencies['@plannotator/opencode'], '0.27.14');
});
test('readonly roles deny ambient tools and general does not delegate', async () => {
  for (const role of ['general', 'explore', 'pr-reviewer', 'web-researcher']) {
    const text = await read(`agents/${role}.md`);
    const permissions = JSON.parse(text.match(/^permissions: (.+)$/m)[1]);
    assert.equal(permissions[0].action, '*'); assert.equal(permissions[0].effect, 'deny');
    if (role !== 'web-researcher') assertChildReads(assert, [...config.permissions, ...permissions]);
    assert.ok(!permissions.some((p) => p.action === 'subagent' && p.effect === 'allow'));
    if (role !== 'general') assert.ok(!permissions.some((p) => ['shell', 'edit', 'create_worktree'].includes(p.action) && p.effect === 'allow'));
  }
});
