import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import plugin, { slashFlag } from './server.js';

const skill = (metadata) => `---\nname: x\ndescription: d\n${metadata}---\n\n# Body\n`;

test('slashFlag reads only metadata.opencode/slash', () => {
  assert.equal(slashFlag(skill('metadata:\n  opencode/slash: "true"\n')), true);
  assert.equal(slashFlag(skill("metadata:\n  opencode/slash: 'true'\n")), true);
  assert.equal(slashFlag(skill('metadata:\n  "opencode/slash": true\n')), true);
  assert.equal(slashFlag(skill('metadata:\n  other: x\n  opencode/slash: "false"\n')), false);
  assert.equal(slashFlag(skill('metadata:\n  opencode/autoinvoke: "true"\n')), false);
  assert.equal(slashFlag(skill('slash: true\n')), false);
  assert.equal(slashFlag(skill('metadata:\n  a: b\nopencode/slash: "true"\n')), false);
  assert.equal(slashFlag('# no frontmatter'), false);
});

test('registers flagged skills, skips taken names, and runs them as skill-attached prompts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-commands-'));
  const file = async (id, metadata) => {
    const target = path.join(dir, `${id}.md`);
    await writeFile(target, skill(metadata));
    return { id, name: id, description: `${id} skill`, path: target, content: '' };
  };
  const skills = [
    await file('pr', 'metadata:\n  opencode/slash: "true"\n'),
    await file('quiet', ''),
    await file('prd', 'metadata:\n  opencode/slash: "true"\n'),
  ];
  const transforms = new Set(), prompts = [];
  let reloads = 0, emit;
  const commands = () => {
    const added = [];
    for (const callback of transforms) callback({ add: (definition) => added.push(definition) });
    return added;
  };
  const ctx = {
    skill: { list: async () => ({ data: skills }) },
    command: {
      async transform(callback) { transforms.add(callback); return { dispose: async () => transforms.delete(callback) }; },
      list: async () => ({ data: [{ name: 'prd' }, ...commands().map(({ name }) => ({ name }))] }),
      reload: async () => { reloads++; },
    },
    session: { prompt: async (input) => { prompts.push(input); } },
    event: {
      async *subscribe({ signal }) {
        while (!signal.aborted) yield await new Promise((resolve) => { emit = resolve; signal.addEventListener('abort', () => resolve({ type: 'end' })); });
      },
    },
  };
  const cleanup = await plugin.setup(ctx);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(commands().map(({ name, description }) => [name, description]), [['pr', 'pr skill']]);
  assert.equal(reloads, 1);

  emit({ type: 'skill.updated' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reloads, 1, 'unchanged catalog does not reload');

  await commands()[0].execute({
    sessionID: 'ses_1', delivery: 'steer',
    prompt: { text: ' open draft ', files: [{ uri: 'file:///a' }], skills: [{ id: 'pr' }, { id: 'tdd' }] },
  });
  await commands()[0].execute({ sessionID: 'ses_1', delivery: 'queue', prompt: { text: '' } });
  assert.deepEqual(prompts, [
    { sessionID: 'ses_1', text: 'open draft', files: [{ uri: 'file:///a' }], skills: [{ id: 'pr' }, { id: 'tdd' }], delivery: 'steer' },
    { sessionID: 'ses_1', text: 'Run the pr skill.', skills: [{ id: 'pr' }], delivery: 'queue' },
  ]);
  await cleanup();
  assert.equal(transforms.size, 0);
});
