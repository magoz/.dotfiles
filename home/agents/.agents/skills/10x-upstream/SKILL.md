---
name: 10x-upstream
description: Port improvements from a 10x-derived project (default o-o) up into the canonical 10x starter (shhhlabs/10x) as reviewed, adapted PRs titled "(port o-o #N)". Use when asked to bring a project's fixes or features back to 10x, assess what a source project has that 10x lacks, or continue a port o-o series.
metadata:
  opencode/slash: 'true'
---

# 10x upstream

Bring a downstream project's improvements into `shhhlabs/10x`. Discovery first, then one adapted
PR per coherent change. Counterpart: `10x-downstream` (10x → company projects).

Arguments: `[source] [#N …] [assess]`. `source` defaults to `o-o`; PR numbers narrow the scope;
`assess` stops after the candidate table (no code).

## Ground rules

- **Project list:** the "Maintained projects" section of 10x `README.md` is the source of truth for
  which projects exist, their repo, relationship (upstream source / downstream fork), origin 10x
  commit and port log. Read it from fresh `origin/main`
  (`git -C ~/dev/repos/10x fetch && git -C ~/dev/repos/10x show origin/main:README.md`). If the
  source is missing there, confirm it is 10x-derived (root commit `Source-10x-Commit:` trailer) and
  ask before porting.
- Checkouts live at `~/dev/repos/<repo>`; `~/dev/repos/<repo>-<branch-slug>` are worktrees, not
  projects. The source repo is read-only here.
- Read 10x root `AGENTS.md` and nested `AGENTS.md` for every touched area first. 10x rules win over
  the source's.
- Never merge or cherry-pick histories across repos. Every port is a reviewed, adapted commit.
- Adapt, don't copy: 10x is the multi-user starter; source product decisions stay in the source.

## 1. Discover

```bash
gh pr list --repo magoz/o-o --state merged --limit 200 --json number,title,mergedAt,mergeCommit
gh pr list --repo shhhlabs/10x --state all --limit 200 --json number,title,state,mergedAt,body
```

Map which source PRs 10x already has. Titles alone are not enough:

- Titles: `(port o-o #18)`, `(port o-o #21, #28)`, bare `(port o-o)` (10x #143–#147), or no
  marker at all (10x #139 = o-o #7, #141 = o-o #9).
- Bodies: "Port of o-o #N", `magoz/o-o#N`, rows of the `| From o-o | What 10x gets |` table,
  "Not included (separate PRs)", "Already in 10x, not re-ported", partial ports ("#3 (non-MCP
  part)"). One 10x PR can cover many (10x #143 ← o-o #2/#3/#8/#10/#13/#15/#16; #144 ←
  #1/#3/#10/#11).
- Reverse ports: source PRs that came FROM 10x ("Port of 10x #N" in the source body; o-o #19 ←
  10x #144, o-o #20 ← 10x #147). Don't re-port them, but diff for leftovers the source added beyond
  10x (o-o #20 also fixed a stale `gmail` tool description 10x still had).
- Verify every "ported" / "missing" claim by grepping 10x `origin/main` code (symbol, test name,
  file, doc line), never by title.

Output a candidate table, in source merge order:

| Source PR | What | Status in 10x | Worth it / why | Size | Risk |
| --------- | ---- | ------------- | -------------- | ---- | ---- |

Status: `ported (10x #N)`, `partial (leftover: …)`, `missing`, `reverse port`, `n/a (source-only)`.
Grouping: bundle small related bug fixes into one PR; keep dependency/major upgrades apart from
fixes; each Yolk canary bump is its own PR, in order (later canaries assume earlier host changes).

In `assess` mode, or when choices need the user, stop here with the table and unresolved questions.

## 2. Plan the PRs

- One coherent change per branch and PR (`feat|fix|chore/<slug>`), in source order when dependent.
- Title: `<what 10x gets> (port o-o #N[, #M])`; Yolk bumps `Yolk canary.N: <what> (port o-o #N)`.
- Multi-release changes stay split. Column drop (o-o #24/#26 → 10x #156): release 1 removes schema
  use with no migration; release 2 (the `DROP COLUMN` migration) ships only after release 1 is live
  in 10x Production. Leave release 2 as a stated follow-up, never in the same PR.

## 3. Implement (per PR)

```bash
git -C ~/dev/repos/10x fetch origin
git -C ~/dev/repos/10x worktree add ~/dev/repos/10x-<branch-slug> -b <branch> origin/main
provision env --repo ~/dev/repos/10x-<branch-slug> --database --non-interactive  # see `provision`
```

- Read the source change: `gh pr view N --repo magoz/o-o`, `gh pr diff N --repo magoz/o-o`, or
  `git -C ~/dev/repos/o-o show <squash>`. Cite the squash SHA.
- When source code lands cleanly, keep it byte-identical and say so: clean applies make the
  downstream ports cheap. Otherwise re-implement at 10x's seams.
- Adapt, and record each adaptation:
  - drop source branding and product policy (o-o single user/owner, `/settings`, "owner's
    subscription") for 10x wording (users connect their own subscriptions; admins use
    Admin → Integrations);
  - rename identifiers (Effect service tags `@o-o/…` → `@10x/…`, names, paths);
  - generalize source-specific code (o-o Google-only accounts → generic multi-account
    `connector-accounts.ts`, so the next provider only extends it);
  - keep 10x-only features working.
- Database: never copy migration folders or `snapshot.json`. Change
  `lib/services/db/schema.ts`, run `pnpm db:migrate:create` in 10x, move any hand-written SQL
  (backfills before indexes) into the generated migration, and pin ordering in
  `migration-text.test.ts` when it matters. Expand-contract only: merge is approval for the
  Production migration (`patterns/DATABASE_MIGRATIONS.md`).
- Yolk: all `@yolk-sdk/*` move together to the same canary; regenerate the lockfile with
  `pnpm install` and check every entry resolves to that canary.
- Update the `AGENTS.md` and `patterns/` text the change touches (100 columns, `pnpm format:fix`).
- Validate: `pnpm verify`; DB integration suites on a disposable `provision db` lease when DB code
  changed; affected `pnpm test:e2e` specs for changed flows.

## 4. Publish

Load the `pr` skill (`draft`, then `ready`; merge only when the user asks). In the managed body:

- `| From o-o | What 10x gets |` table: source PR, squash SHA, canary → concrete 10x change.
- "Not included (separate PRs)" and "Already in 10x, not re-ported" when relevant.
- "10x adaptation (differs from o-o)": every branding, naming or generalization change.
- "Downstream ports: self-contained | apply after 10x #N; migration: none | <name>", so
  `10x-downstream` knows order and migration work.
- Evidence verified only in the source (live sessions) labelled as such; "No live 10x run" if so.

Two independent review opinions come from the `pr` skill; disposition every finding.

## Finish

Report: source PR → 10x PR/status table, skipped items with reasons, follow-ups (release 2s,
deferred findings), then unresolved questions (extremely concise).
