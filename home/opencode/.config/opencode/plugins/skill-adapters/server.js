import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const body = (source) => source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
export const digest = (content) => createHash('sha256').update(content.trim()).digest('hex');
const HEADER = '# OpenCode assessment runtime adapter';
export const runtime = `${HEADER}

These runtime substitutions apply only in OpenCode. The policy below remains authoritative for GitHub authorization, exact review targets, ownership, evidence, and safety; never weaken those gates.

- Use native subagent({agent, description, prompt, background:true}). New children are fresh; include complete context. Pass sessionID to continue/steer the same child. Do not invent Pi-only action/tasks/chain/context/acceptance fields or call a Pi CLI. Foreground delegation is valid when results must be received before continuing.
- Frozen PR reviews use INLINE delivery through native subagent.prompt, never path-only external bundles or Pi reads parameters. Parent freezes outside the repository as policy requires, sanitizes BEFORE freezing/hashing (if redaction would omit change-critical evidence, block), then supplies the COMPLETE exact UTF-8 binary diff with git-blob digest, one immutable target, exactly one axis, scope/specification, changed-file inventory, validation results/skips and applicable guidance/axis skills in audit-only mode. Do not transform patch bytes or hash a different diff. Use the local skill-adapters/review-bundle.js reviewPrompt(bundle, budgetBytes) transport helper; see its README for schema. Reserve model context for role/tools/output and set an explicit complete-prompt byte budget no larger than 256 KiB. If all required evidence (including visual proof when required) cannot fit or cannot be represented inline, return blocked; never summarize/truncate, omit evidence, read external paths, grant /tmp/home access, or claim review passed. The helper validates inline transport, not sanitation, evidence quality or native model context capacity. Parent must check those gates. External-directory denials stay intact. This transport substitution also overrides reads/path-only directions in persisted/supporting policy text.
- Roles: general (single implementation writer), explore (read-only files), pr-reviewer (read-only frozen review bundle, exactly one axis), web-researcher (public primary sources). Confirm availability before delegation. Independent review is mandatory where the policy requires it; missing evidence is blocked, not passed. Parent runs validation and records results; no claim of Pi runtime acceptance verification.
- create_worktree uses the pane-local dotfiles-tools bridge and explicitly launches OpenCode. Never use raw shell worktree creation from the shared server's Herdr environment. The bridge requires native local confirmation. Missing Vercel linkage returns structured guidance; resolve only a verified existing project/team, then retry the same request. Allocation failures preserve resources and must not be retried blindly.
- Successful handoff RETAINS the source TUI. Destination owns implementation; stop source work and tell the user to exit only this source manually. Do not stop/restart the shared service or broadcast an exit. One source may claim/handoff only one issue. If tool/client/role support is absent, stop before claiming an issue.
- Managed worktree cleanup MUST go through pane-local /worktrees (or worktree-manage in the intended Herdr shell), with an exact confirmed plan token. It releases database leases before removing Herdr workspace/checkout and keeps branches unless safely deletable. Never follow raw Git cleanup instructions for a managed checkout. Preserve the policy's ownership, expected-SHA, lock and receipt gates before offering cleanup. Do not use Pi's retirement dashboard for OpenCode/mixed worktrees.
- Plannotator CLI commands use $HOME/.config/opencode/bin/plannotator (or an explicit PLANNOTATOR_BIN override), not a global CLI. Do not install shared hooks/skills or change Pi's defaults.
- /skill:name spelling below means /name or skill({id:"name"}). Agent tool/general-purpose references mean native subagent/general. Prefer native question for user decisions. until requires explicit local consent; no unsafe shell watchers.

## Canonical policy (runtime names adapted; shared source unmodified)

`;

export function adapt(skill, expected, roots) {
  if (!expected[skill.id] || !roots.some((root) => path.resolve(skill.location) === path.join(root, skill.id, 'SKILL.md'))) return undefined;
  if (digest(skill.content) !== expected[skill.id]) return {
    content: `OpenCode assessment adapter for ${skill.id} is stale. STOP this workflow before any mutation. Review the changed canonical skill and update the adapter digest/tests; never silently bypass its safety policy.`,
    autoinvoke: false,
  };
  const content = skill.content.replace(/\bPi\b/g, 'OpenCode').replaceAll('pi-subagents', 'OpenCode native subagents')
    .replaceAll('/skill:', '/').replaceAll('general-purpose', 'general').replaceAll('`Agent` tool', '`subagent` tool')
    .replaceAll('Give both the frozen bundle through `reads`.', 'Give each the COMPLETE frozen bundle INLINE through native `subagent.prompt`, using the runtime transport contract above.');
  return { content: runtime + content };
}

export default {
  id: 'dotfiles-skill-adapters',
  async setup(ctx) {
    const expected = JSON.parse(await readFile(new URL('./sources.json', import.meta.url), 'utf8'));
    const shared = path.join(homedir(), '.agents', 'skills');
    const roots = [shared, path.join(homedir(), '.config', 'opencode', 'shared-skills')];
    try { roots.push(await realpath(shared)); } catch { /* Source absent: no adapters. */ }
    const transformed = new WeakSet();
    const transform = (skills) => {
      for (const skill of skills.list()) {
        if (transformed.has(skill)) continue;
        const update = adapt(skill, expected, roots);
        if (update) skills.update(skill.id, (target) => {
          Object.assign(target, update);
          transformed.add(target);
        });
      }
    };
    const lifetime = new AbortController();
    let registration = await ctx.skill.transform(transform), pending = Promise.resolve();
    // V2 activates config.skill AFTER user plugins. Reposition rather than assuming
    // setup registration order; keep the old transform until its replacement exists.
    const refresh = () => {
      pending = pending.then(async () => {
        if (lifetime.signal.aborted) return;
        const next = await ctx.skill.transform(transform), previous = registration;
        registration = next;
        await previous.dispose();
      });
      return pending;
    };
    const hooks = await Promise.all([
      ctx.session.hook('prompt', refresh),
      ctx.session.hook('context', async (context) => {
        await refresh();
        // session.skill can persist a raw skill before context preparation. Keep
        // runtime substitutions authoritative even for that already-saved message.
        const { data: skills } = await ctx.skill.list();
        const blocked = skills.filter((skill) => skill.content.startsWith('OpenCode assessment adapter for ')).map((skill) => skill.content);
        context.system.push({ type: 'text', text: runtime.split('## Canonical policy')[0] + blocked.join('\n') });
      }),
      ctx.tool.hook('execute.before', async (call) => { if (call.tool === 'skill') await refresh(); }),
    ]);
    const events = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: lifetime.signal })) {
          if (event.type === 'plugin.updated') await refresh();
        }
      } catch { /* Prompt/tool hooks remain the synchronous safety boundary. */ }
    })();
    return async () => {
      lifetime.abort();
      await Promise.all(hooks.map((hook) => hook.dispose()));
      await events; await pending; await registration.dispose();
    };
  },
};
