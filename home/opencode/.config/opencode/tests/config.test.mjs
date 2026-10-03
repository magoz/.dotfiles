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
      assert.ok(['./plugins/opencode-anthropic-auth', './plugins/opencode-anthropic-auth/gateway'].includes(target), target);
      await access(new URL(`${target}/index.mjs`, root));
    });
  }
  const cli = JSON.parse(await read('cli.json'));
  // String entries starting with "-" disable an auto-discovered plugin by id.
  for (const entry of cli.plugins) {
    if (typeof entry === 'string' && entry.startsWith('-')) continue;
    await access(new URL(`${entry.package}/tui.js`, root));
  }
  assert.ok(cli.plugins.includes('-ocv-plugin'));
  // Fleet is auto-discovered from plugins/fleet; its entry imports only host-provided modules.
  const fleet = await read('plugins/fleet/tui.js');
  assert.deepEqual([...fleet.matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['@opentui/solid', 'solid-js', './view.js']);
  assert.match(await read('plugins/herdr-opencode/tui.js'), /HERDR_INTEGRATION_VERSION=12/);
  assert.match(await read('plugins/herdr-opencode/server.js'), /setup\(\) \{\}/);
});
test('subs-claude fails closed: sentinel baseURL, gateway plugin before direct mode, no key', async () => {
  const { SENTINEL_ORIGIN, SENTINEL_PREFIX } = await import(
    new URL('plugins/opencode-anthropic-auth/gateway/shaping.mjs', root).href
  );
  const provider = config.providers['subs-claude'];
  assert.equal(provider.package, '@opencode/ai/providers/anthropic');
  assert.deepEqual(provider.settings, { baseURL: `${SENTINEL_ORIGIN}${SENTINEL_PREFIX}/v1` });
  assert.deepEqual(Object.keys(provider.models), ['claude-opus-5-5']);
  const gateway = config.plugins.indexOf('./plugins/opencode-anthropic-auth/gateway');
  assert.ok(gateway !== -1 && gateway < config.plugins.indexOf('./plugins/opencode-anthropic-auth'));
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
