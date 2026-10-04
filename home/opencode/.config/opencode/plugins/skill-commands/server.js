import { readFile } from 'node:fs/promises';

// Registers `/<skill-id>` for every skill whose SKILL.md frontmatter sets
// `metadata.opencode/slash: "true"`. OpenCode V2 dropped native skill slash
// commands (v2.0.4); this restores them from the same flag. Running `/pr args`
// sends `args` as a prompt with the `pr` skill attached, like `@pr args`.

const FLAG = 'opencode/slash';

/** Reads `metadata.opencode/slash` from SKILL.md frontmatter; anything but true/"true" is off. */
export function slashFlag(text) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!frontmatter) return false;
  let metadata = false;
  for (const line of frontmatter[1].split(/\r?\n/)) {
    if (/^metadata:\s*$/.test(line)) { metadata = true; continue; }
    if (!metadata) continue;
    if (!/^\s/.test(line)) { metadata = false; continue; }
    const entry = /^\s+(["']?)([^"':]+)\1:\s*(["']?)([^"']*)\3\s*$/.exec(line);
    if (entry?.[2] === FLAG) return entry[4].trim().toLowerCase() === 'true';
  }
  return false;
}

/** Slash-flagged skills, minus names already taken by other commands. */
export async function discover(ctx, ours) {
  const [{ data: skills }, { data: commands }] = await Promise.all([ctx.skill.list({}), ctx.command.list({})]);
  const taken = new Set(commands.map((command) => command.name).filter((name) => !ours.has(name)));
  const found = new Map();
  for (const skill of skills) {
    if (taken.has(skill.id)) continue;
    const text = await readFile(skill.path, 'utf8').catch(() => '');
    if (slashFlag(text)) found.set(skill.id, skill.description);
  }
  return new Map([...found].sort(([a], [b]) => a.localeCompare(b)));
}

export const run = (ctx, id) => async ({ sessionID, prompt, delivery }) => {
  await ctx.session.prompt({
    sessionID,
    text: prompt.text.trim() || `Run the ${id} skill.`,
    ...(prompt.files?.length ? { files: prompt.files } : {}),
    ...(prompt.agents?.length ? { agents: prompt.agents } : {}),
    skills: [{ id }, ...(prompt.skills ?? []).filter((skill) => skill.id !== id)],
    delivery,
  });
};

const same = (a, b) => a.size === b.size && [...a].every(([id, description]) => b.get(id) === description);

export default {
  id: 'dotfiles-skill-commands',
  async setup(ctx) {
    let current = new Map();
    const registration = await ctx.command.transform((editor) => {
      for (const [id, description] of current) {
        editor.add({ name: id, ...(description ? { description } : {}), execute: run(ctx, id) });
      }
    });
    // Skills load after user plugins and can change at runtime, so discovery
    // runs off the setup path and again on catalog events.
    let pending = Promise.resolve();
    const refresh = () => {
      pending = pending.then(async () => {
        const next = await discover(ctx, new Set(current.keys()));
        if (same(current, next)) return;
        current = next;
        await ctx.command.reload();
      }).catch(() => { /* Next event retries; existing commands stay registered. */ });
      return pending;
    };
    const lifetime = new AbortController();
    const events = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: lifetime.signal })) {
          if (['skill.updated', 'config.updated', 'plugin.updated'].includes(event.type)) await refresh();
        }
      } catch { /* Subscription ended; commands keep their last state. */ }
    })();
    void refresh();
    return async () => {
      lifetime.abort();
      await events; await pending; await registration.dispose();
    };
  },
};
