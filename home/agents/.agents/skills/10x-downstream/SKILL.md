---
name: 10x-downstream
description: Port merged 10x (shhhlabs/10x) PRs down into 10x-derived company projects (e.g. taus-10x, lmk-relining-10x, shhh-10x) as one adapted "(port 10x #N)" PR each, in 10x merge order, preserving target-only features. Use when asked to sync, update or port 10x changes into a downstream project.
metadata:
  opencode/slash: 'true'
---

# 10x downstream

Bring merged 10x PRs into a company project that was generated from 10x and diverges on purpose.
One reviewed, adapted PR per 10x PR, in 10x merge order. Counterpart: `10x-upstream`.

Arguments: `<target …> [#N … | through #N]`. The user names the target(s); never pick one. With
several targets, finish the whole sequence for one before the next.

## Ground rules

- **Project list:** the "Maintained projects" section of 10x `README.md` is the source of truth for
  which projects exist, their repo, origin 10x commit and port log. Read it from fresh
  `origin/main` (`git -C ~/dev/repos/10x fetch && git -C ~/dev/repos/10x show origin/main:README.md`).
  A target missing there: confirm it is 10x-derived (root commit `Source-10x-Commit:` trailer or
  AGENTS.md) and ask before porting.
- Checkouts live at `~/dev/repos/<repo>`; `~/dev/repos/<repo>-<branch-slug>` are worktrees.
- Read the target's root `AGENTS.md`, nested `AGENTS.md` for touched areas, its port log and
  divergence plans first (taus: `plans/replatform-on-10x.md`). Target rules win over 10x's.
- Never merge 10x history into the target. Every port is a reviewed, adapted commit.
- Preserve target-only features, naming and product decisions. Ask before any new product decision.

## 1. Find the sync point

- Port log (path in the README list; e.g. taus `plans/10x-port-assessment.md` "Sync log", lmk
  `plans/port-10x-updates.md` waves, shhh `plans/port-10x-*.md`): latest synced 10x squash and PR,
  explicit skips with reasons (taus skips #144 remote MCP by operator decision), not-ported ranges.
- Target PRs: `gh pr list --repo <owner>/<target> --state all --limit 200 --json number,title,body`.
  Match `(port 10x #N)` titles, `Port of 10x #N` bodies, and unmarked ports with 10x's own title or
  branch (taus #52 = 10x #139).
- 10x PRs merged since, oldest first:

  ```bash
  git -C ~/dev/repos/10x log --reverse --format='%h %s' <last-synced-squash>..origin/main
  gh pr list --repo shhhlabs/10x --state merged --limit 100 --json number,title,mergedAt,mergeCommit
  ```

  Squash subjects end with `(#N)`. Ignore closed-unmerged PRs and issue numbers.
- Another downstream may already have ported the same PR
  (`gh pr list --repo shhhlabs/<other> --search "port 10x #N"`): read its adaptations and conflict
  notes first (lmk is the reference downstream).
- Read each 10x PR body: "Downstream ports" line (order, migration), "10x adaptation", "Not
  included", release 1/2 notes.

Output a plan table and confirm it when anything is a skip or a judgment call:

| 10x PR | Squash | What | Plan (port / adapt / skip: why / defer) | Migration | After |
| ------ | ------ | ---- | --------------------------------------- | --------- | ----- |

## 2. Port one 10x PR at a time, in merge order

Branch `feat/port-10x-<N>-<slug>` (`fix/` or `chore/` when 10x's type is), from fresh target
`origin/main` once the previous port is merged; otherwise stack on the previous port branch and say
so ("Part 2 of 3").

```bash
git -C ~/dev/repos/<target> fetch origin
git -C ~/dev/repos/<target> worktree add ~/dev/repos/<target>-<branch-slug> -b <branch> origin/main
provision env --repo ~/dev/repos/<target>-<branch-slug> --database --non-interactive
git -C ~/dev/repos/10x diff <squash>^ <squash> > /tmp/10x-<N>.patch
git -C ~/dev/repos/<target>-<branch-slug> apply -3 /tmp/10x-<N>.patch
```

- Resolve conflicts by hand: keep target-only code, take upstream design. Count them for the PR.
  Never hand-merge `pnpm-lock.yaml`; regenerate with `pnpm install`.
- Preserve target areas and naming. taus: Fortnox, Enable Banking bank, companies, tasks, notices,
  its crons in `vercel.json`, `taus10x` naming. lmk: Swedish UI copy, Fortnox. shhh: Telegram. Keep
  each repo's existing Effect service tag prefix (taus, lmk, shhh keep `@10x/…`); don't rename.
- Upstream code touching areas the target removed or replaced: drop those hunks and list them as
  "Not applicable" (taus: 10x per-user Dropbox setup, remote-MCP contexts while #144 is skipped).
- Migrations: delete 10x's migration folder (`migration.sql`, `snapshot.json`) from the applied
  patch; never copy snapshot JSON. Apply the `schema.ts` change, run `pnpm db:migrate:create` on the
  target's chain (new timestamp), carry 10x's hand-written SQL (backfills before indexes) into it,
  adapt predicates to target scopes, and pin order in `migration-text.test.ts` when 10x did
  (10x #147/#148 → taus #57/#58, lmk #80/#81). `drizzle-kit generate` must then report no drift.
- Multi-release changes (10x #156, column drop release 1): release 2 only after the target's own
  release 1 is live in the target's Production.
- Yolk: after the port every `@yolk-sdk/*` sits at the same canary as 10x did; canary bumps land in
  order (#151 → #152 → #153).
- Validate: `pnpm verify`; `pnpm test:db` (or the target's DB suite command) on the worktree's
  disposable lease when DB code or queries changed; affected e2e specs. Follow target AGENTS.md
  notes (taus: load `.env.test` with `process.loadEnvFile`, not shell sourcing).

## 3. Record and publish

- Port log entry in the target's format. taus:
  `### <date>: 10x #N (<what>), branch <branch>` with bullets Ported (squash, `git apply -3`,
  conflicts, lockfile), Taus adaptations, Checked, Deferred (known divergence), Not applicable;
  then update the "Latest 10x sync point" header (squash, PR, ported/skipped list).
- Commit and PR title: 10x's title plus `(port 10x #N)`. Body: link 10x PR and squash, how applied
  and conflict count, target adaptations table, known divergences, validation, "Part i of n".
- Load the `pr` skill (`draft`, then `ready`; merge only when the user asks).

## Finish

Report per target: 10x PR → target PR/status table, skipped with reasons, deferred divergences,
release-2 follow-ups, new sync point, then unresolved questions (extremely concise).
