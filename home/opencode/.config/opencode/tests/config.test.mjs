import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { assertChildReads } from './permissions.mjs';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const config = JSON.parse((await read('opencode.jsonc')).replace(/^\s*\/\/.*$/gm, ''));
test('OpenCode uses native compaction/models and only the shared ~/.agents skill source', async () => {
  assert.equal(config.compaction.auto, true);
  assert.equal(config.model, 'subs-claude/claude-opus-5-5');
  assert.equal(config.agents.build.model, 'subs-claude/claude-opus-5-5#high');
  assert.equal(config.agents.build.system, undefined);
  // Skills live only in ~/.agents/skills, which OpenCode and Pi discover natively.
  assert.equal(config.skills, undefined);
  await assert.rejects(access(new URL('skills', root)));
  assert.ok(!JSON.stringify(config).includes('/Users/'));
});
test('OpenCode agents are generated from the shared ~/.agents/agents definitions', async () => {
  const { plan, SOURCE } = await import(new URL('scripts/sync-agents.mjs', root).href);
  const { writes, removals } = await plan();
  assert.deepEqual([...writes.map((w) => w.entry), ...removals], [], 'run `npm run sync:agents`');
  const shared = (await readdir(SOURCE)).filter((entry) => entry.endsWith('.md')).sort();
  assert.deepEqual(shared, ['aha.md', 'explore.md', 'general.md', 'pr-reviewer.md', 'tech-lead.md', 'ui-design.md', 'web-researcher.md']);
});
test('server and TUI integration entrypoints exist; pinned V2 Herdr assets', async () => {
  for (const target of config.plugins) {
    // Effect plugins (plugins/until) are TypeScript; OpenCode loads `server.ts` directly.
    await access(new URL(`${target}/server.js`, root)).catch(() => access(new URL(`${target}/server.ts`, root))).catch(async () => {
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
  // Fleet replaces the session sidebar's content; 'auto' shows it when the terminal is wide enough.
  assert.equal(cli.session.sidebar, 'auto');
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
test('child agents deny by default, never delegate, and only writers may edit or run shell', async () => {
  const writers = new Set(['general', 'aha']);
  for (const role of ['aha', 'explore', 'general', 'pr-reviewer', 'tech-lead', 'ui-design', 'web-researcher']) {
    const text = await read(`agents/${role}.md`);
    const permissions = JSON.parse(text.match(/^permissions: (.+)$/m)[1]);
    assert.equal(permissions[0].action, '*'); assert.equal(permissions[0].effect, 'deny');
    if (role !== 'web-researcher') assertChildReads(assert, [...config.permissions, ...permissions]);
    assert.ok(!permissions.some((p) => p.action === 'subagent' && p.effect === 'allow'), role);
    if (!writers.has(role)) assert.ok(!permissions.some((p) => ['shell', 'edit', 'create_worktree'].includes(p.action) && p.effect === 'allow'), role);
  }
});
test('Effect plugins pin the Effect version OpenCode is built on and type-check', async () => {
  const until = JSON.parse(await read('plugins/until/package.json'));
  const cli = JSON.parse(await read('plugins/until/node_modules/@opencode/plugin/package.json'));
  assert.equal(until.dependencies.effect, cli.dependencies.effect, 'bump effect with @opencode/plugin');
  assert.equal(until.devDependencies['@opencode/plugin'], until.dependencies['@opencode/schema']);
});
