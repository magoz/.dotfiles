---
name: pr
description: Prepare, create, update, ready, audit, and squash-merge pull requests using the current repository's own policies, tooling, and validation commands. Use for draft synchronization, readiness gates, pre-merge audits, and guarded merge cleanup.
compatibility: Requires git, GitHub CLI authentication, and Pi with the pi-subagents package.
metadata:
  opencode/slash: 'true'
---

# PR

Manage the current repository's pull request from work in progress through guarded squash merge and
cleanup. This is a parent-session orchestration skill. The parent remains the sole writer and
decision-maker; `pr-reviewer` children are independent and read-only.

Repository policy comes from the repository, not this skill. Never import another project's stack,
commands, branch conventions, deployment providers, or quality gates.

## Modes

| Invocation                 | Behavior                                                               |
| -------------------------- | ---------------------------------------------------------------------- |
| `/skill:pr`                | Prepare, commit, push, and create/update; new PRs start as drafts      |
| `/skill:pr ready`          | Prepare, validate, push, review, and mark the PR ready                 |
| `/skill:pr pre-merge [PR]` | Audit an exact remote PR head; never merge                             |
| `/skill:pr merge`          | Ready, audit, squash-merge, delete the branch, and remove its worktree |

A pre-merge PR argument may be a number or URL. With no argument, resolve the PR for the current
branch. Merge mode always targets the current branch because its cleanup is tied to the current linked
worktree.

## Authority

Use this precedence when requirements or commands disagree:

1. User instructions and the supplied task/specification
2. Root and applicable nested `AGENTS.md` files or repository-declared equivalents
3. Normative guides explicitly linked by those files
4. Repository-owned manifests, task runners, CI configuration, and required-check settings
5. Clear local precedent in adjacent implementation and tests

Treat inferred precedent as a judgment call, not a documented violation. Missing repository guidance
is a gap to report, not permission to invent policy.

## Interaction model

Invoking a mode authorizes its routine actions. Follow the obvious happy path without asking for
confirmation, narrating every Git step, or treating draft state as a problem.

- `/skill:pr` authorizes the always-on Conform/Learn/Tidy preparation pass, staging task-owned files,
  committing, pushing, safely updating a rewritten PR branch with an explicit-SHA force lease, and
  creating or updating a PR. A new PR is a draft; an existing draft remains a draft. Do not publish an
  unvalidated new head to a ready PR in this mode; require `/skill:pr ready` unless the remote head is
  unchanged and only managed metadata is updated.
- `/skill:pr ready` runs the same preparation pass and additionally authorizes full repository-defined
  validation, independent readiness review, PR body updates, and `gh pr ready` after all gates pass.
- `/skill:pr pre-merge` authorizes read-only Git/GitHub inspection plus an isolated temporary clone and
  review artifacts outside the repository. All fetch, checkout, installation, and validation work
  occurs in temporary state; the current repository and GitHub state must remain unchanged.
- `/skill:pr merge` authorizes the full Ready workflow, exact Pre-merge workflow, squash merge, guarded
  source-branch deletion, linked-worktree removal, and local branch-ref deletion. The invocation is the
  user's explicit authorization for those destructive cleanup steps after merge safety gates pass.

Ask only when work contains genuinely unrelated files, intent or desired branch history remains
ambiguous after inspection, a closed/merged PR cannot be handled safely, a destructive or credentialed
validation environment needs attestation, a required check cannot be satisfied, or a product,
architecture, access-control, migration, or scope decision is needed. Routine commit messages, draft
creation, pushes, rebases, history updates, managed-body updates, ready transitions, squash merge, and
verified branch/worktree cleanup do not need a second confirmation in their authorized modes.

## Invariants

- Never commit PR work directly to the remote default branch or operate from a detached HEAD,
  ambiguous repository, or unexpected remote. In default or `ready` mode, create a conventional branch
  automatically when intent is clear on the default branch; ask only when its name or scope is
  genuinely ambiguous.
- Protect the default branch. On the current non-default PR branch, rewrite history when needed to
  make the PR reflect intended local work. Capture the previously observed remote head and use
  `--force-with-lease=<ref>:<sha>` with an explicit remote and refspec. Never weaken the lease by
  refreshing its expected SHA and blindly retrying; inspect newly discovered remote-only commits and
  ask before dropping any whose ownership or intent is unclear. Do not merge, close/reopen a PR,
  change its base, or delete a branch unless requested. Mark a draft ready only in `ready` mode after
  all gates pass.
- Never run destructive database, production-data, deployment, publish, migration-application,
  infrastructure-apply, or environment-reset commands as ordinary PR preparation. Follow stricter
  repository safety contracts when present.
- Run destructive or credentialed end-to-end checks only when repository guidance identifies the safe
  environment and the operator provides any required attestation. Missing required evidence is `not
run` or `blocked`, never `passed`.
- Infer the exact task-owned path set from the conversation and diff, then stage only those paths.
  Never use broad staging such as `git add -A`, hide unrelated changes, or discard work. Ask only when
  ownership is ambiguous.
- Keep one writer: the parent session. Review subagents never edit.
- Bind every review and validation claim to an unchanged patch digest or commit SHA.
- Preserve draft state except in `ready` mode. Never push an incompletely validated new head to an
  existing ready PR, and always preserve human-authored PR content.
- Stop for unapproved product, architecture, access-control, data, migration, or scope decisions.
- Merge only in `/skill:pr merge`, only by squash, and only after unchanged-head Ready and Pre-merge
  gates pass. Never use administrator bypass, enable auto-merge, enter a merge queue, or fall back to
  merge-commit or rebase strategies.
- Never remove a primary checkout, dirty worktree, mismatched worktree, or branch/ref that moved after
  validation. Cleanup uses exact-path and expected-SHA guards and never uses forced worktree removal.

## Repository discovery

Before choosing commands or gates:

1. Resolve the repository root, remote default branch, current branch, and applicable project guidance.
2. Read root and nearest owner guidance for changed files plus only the normative documents it links.
3. Inspect manifests, lockfiles, task runners, CI workflows, and branch/check configuration needed to
   identify the package manager and required commands.
4. Classify checks as repository-required, behavior-relevant, environment-dependent, or optional.
5. Prefer repository-documented commands. Otherwise infer conservatively from executable configuration;
   do not assume fixed script names or a package manager.
6. Treat deployment-provider checks as ordinary required checks only when the repository or branch
   policy requires them. Do not hardcode a provider.

## Preflight

For every mode:

1. Confirm repository root, current branch, worktree status, `git` availability, `gh auth status`, and
   the GitHub repository/default branch. Resolve the unambiguous GitHub push remote from the branch
   upstream, configured push remote, remotes, and `gh` repository identity; use `origin` only when it
   is verified as that remote. Verify any repository-declared runtime version.
2. Confirm `pi-subagents` is available and user/project agent `pr-reviewer` is discoverable. If not,
   stop and suggest installing/configuring the dependency; do not silently downgrade independent
   review.
3. Detect PR state before any GitHub write. Query open and closed/merged PRs for the head branch. Never
   create a duplicate or reuse a closed/merged PR without asking.
4. Resolve the base from an existing PR, otherwise from the remote default branch. Do not silently
   hardcode a different base.
5. Establish intent from the conversation, linked issue, supplied plan/specification, commits, and
   repository guidance. If intent remains ambiguous, ask before reviewing or writing a PR summary.

## Always-on preparation (`/skill:pr` and `/skill:pr ready`)

Run this pass before staging or committing in either mutation mode. It keeps every published update
aligned with repository policy, but it is not by itself a merge-readiness claim.

1. Resolve the intended changed paths and perform Repository discovery for their owning areas.
2. Load and follow `conform` in mutation mode for intended implementation, test, and behavior-bearing
   tooling changes. Keep fixes surgical and preserve unrelated work.
3. Run the narrowest safe checks needed to catch preparation mistakes, including `git diff --check`
   and applicable changed-file formatting or focused static checks. Broader readiness commands may
   remain `not run` in draft mode but must be reported honestly.
4. Load and follow `learn` to capture only durable knowledge established by the work. It is valid for
   Learn to conclude that nothing should be recorded.
5. Load and follow `tidy` for the affected knowledge and project-instruction scope. Fix stale or
   misplaced guidance exposed by the work without broadening into an unrelated documentation audit.
6. Format approved changed documentation and agent files with repository tooling, validate changed
   links/paths where applicable, and inspect the complete prepared diff for accidental churn.
7. Treat accepted Conform/Learn/Tidy edits as task-owned only when they directly support the current
   work. Ask before including unrelated cleanup, and never stage it silently.

## Draft synchronization (`/skill:pr`)

Draft synchronization publishes work in progress; it does not claim merge readiness. Draft state is
normal and should not produce warnings or extra confirmation prompts. If the existing PR is ready and
the operation would change its remote head, stop and require `/skill:pr ready`; do not silently retain
ready or auto-merge eligibility for an incompletely validated commit.

1. Complete the Always-on preparation pass, then inspect staged, unstaged, and untracked paths. Infer
   the intended set from the current task and ask only when files are genuinely unrelated or
   ambiguous.
2. Block publication hazards: tracked credentials or environment files, private keys, generated build
   or test artifacts, unexplained binary/large files, merge markers, or unrelated changes. Apply any
   stricter repository rules.
3. Stage only task-owned paths and run `git diff --cached --check`. A draft may have incomplete tests,
   but its body must report checks honestly.
4. Generate an accurate commit message from the task, repository convention, and diff. Commit when
   needed, then synchronize the current PR branch: use a normal explicit remote/refspec push when it
   fast-forwards. For an intentional rewrite, capture the remote branch SHA before reconciliation and
   push with `--force-with-lease=<full-ref>:<observed-sha> <remote> HEAD:<full-ref>`. On a lease race,
   inspect the new remote history; retry with a new explicit lease only when no unexpected remote-only
   commit would be dropped. Never create another branch merely because the PR branch was rebased.
5. If no open PR exists, create one with `gh pr create --draft`. If a draft exists, update it rather
   than creating another. A ready PR may receive managed-body-only updates when its head is unchanged;
   changing its head requires the Ready workflow.
6. Verify the resulting URL, base, head branch, and remote head SHA.

### Managed PR body

Maintain generated content inside one block:

```md
<!-- pi-pr:start -->

## Summary

...

## Validation

- `command` — passed, failed, or not run (reason)

## Review

...

## Remaining risks

...
<!-- pi-pr:end -->
```

Replace only this block on later runs. If an existing PR has no block, preserve its body and append
one. If a project-local predecessor left one clearly equivalent managed block, replace that block and
normalize only its boundary markers rather than appending duplicate generated content. Never rewrite
an existing title or text outside the block unless the user explicitly requests it. Record the
reviewed head SHA when readiness evidence exists.

## Ready workflow (`/skill:pr ready`)

A ready run may create the draft if necessary, but it must not mark the PR ready until all gates pass.

### 1. Establish the review target

- Complete the Always-on preparation pass.
- Resolve the full prepared diff against the current remote base, including confirmed uncommitted
  files when present.
- Refresh Repository discovery for any areas added during preparation.
- Record changed paths and separate implementation/test changes, documentation changes, and
  behavior-bearing tooling/configuration changes.
- Build a validation matrix with each command's source, relevance, safety constraints, and required
  outcome.

### 2. Code loop

1. Treat the Always-on preparation pass as the first Conform iteration. If subsequent edits or review
   fixes change implementation, tests, or behavior-bearing tooling, re-run `conform` surgically before
   freezing the next review target.
2. Format only approved changed files using repository tooling, then run cheap deterministic checks
   such as `git diff --check` followed by the repository-required formatting, type, lint, or static
   checks in increasing cost order.
3. Run focused tests for changed behavior, then the repository's required broader test and build
   commands. When dependency metadata changed, run the repository's lockfile/frozen-install check if
   safe and required. Record environment-dependent skips.
4. Run end-to-end, integration, deployment-preview, migration, or infrastructure validation only when
   relevant and safe under repository policy. Missing evidence for a repository-required or
   change-critical check blocks ready rather than being inferred as success.
5. Freeze the implementation patch before independent review:
   - write scope/specification, changed paths, exact binary patch, and validation evidence to a
     temporary directory outside the repository;
   - compute the patch digest with `git hash-object --stdin` over the exact binary diff;
   - do not edit while reviewers inspect it.
6. Launch `pr-reviewer` in fresh context for two parallel axes:
   - **Standards**, with the `conform` skill supplied and explicit `--check`/no-edit instructions;
   - **Spec**, with the exact requirements and no inherited implementation rationale.
     Give both the frozen bundle through `reads`. Omit reviewer acceptance gates and project-file
     outputs.
7. The parent verifies and dispositions every finding. Blocker/high findings must be fixed; medium
   findings need an explicit fix-or-defer disposition. Ignore unsupported or optional churn.
8. If accepted fixes change implementation, tests, or behavior-bearing tooling, repeat this code loop
   against a new digest. Stop and ask on repeated no-progress findings, reviewer disagreement about a
   blocker, or scope expansion. Do not loop for optional polish.

### 3. Documentation pass

The Always-on preparation pass already runs Learn and Tidy once. After implementation review is stable:

1. Re-run `learn` only when review fixes or later decisions introduced additional durable knowledge.
2. Re-run `tidy` when later changes affected guidance, paths, commands, or project-local agent
   instructions; otherwise retain the already prepared documentation.
3. Format changed documentation/agent files with repository tooling and run the narrowest relevant
   documentation, formatting, stale-reference, and link checks.
4. Freeze one complete bundle containing the stabilized implementation patch, documentation patch,
   scope, changed paths, and validation evidence. Launch a fresh **Knowledge** `pr-reviewer` with
   `learn` and `tidy` supplied in `--check`/no-edit mode.
5. When agent instructions, executable config, or other behavior-bearing tooling guidance changed,
   also run fresh Standards and Spec axes against that complete bundle. Tool and capability policy is
   not documentation-only merely because it is written in Markdown.
6. Fix blocker/high findings and explicitly disposition medium findings. Re-run only axes invalidated
   by subsequent changes.
7. Return to the code loop only if documentation changed an implementation rule, executable config,
   or exposed a real implementation contradiction.

### 4. Final gate

Before marking ready:

- Recompute implementation and documentation digests and confirm reviewed content did not change.
- Re-run cheap repository-required final checks, including diff and formatting checks where available.
- Confirm every required validation command passed, no blocker/high finding remains, all medium
  findings are dispositioned, and skips/residual risks are explicit.
- Stage only reviewed paths. Ensure no unrelated or unreviewed file enters the commit, then run
  `git diff --cached --check` against the exact index that will be committed.
- Commit if necessary, synchronize the current PR branch with the same explicit remote/refspec normal
  push or explicit-SHA force-lease procedure used above, then verify the remote PR head equals the
  tested commit SHA.
- If no open PR exists, create a draft using Draft synchronization with the already validated commit
  and managed body.
- Update the managed PR body with final evidence.
- Inspect required remote checks, review state, conflicts, and deployment status defined by repository
  or branch policy. Do not substitute remote checks for missing local evidence.
- If all gates pass, run `gh pr ready` without another confirmation; invoking `ready` already granted
  that authority. If the PR is already ready, update evidence without toggling state.

## Pre-merge workflow (`/skill:pr pre-merge [PR]`)

This mode is audit-only and must not edit project files, commits, branches, the current repository's
Git state, or GitHub state.

1. Resolve PR identity through read-only local inspection and GitHub queries, then create an isolated
   temporary clone outside the repository. Fetch and check out the exact current remote base and PR
   head SHAs only inside that clone. Perform all dependency installation and validation there, and
   remove temporary state after reporting. Never fetch into or validate in the current repository.
2. Require the current remote base to be an ancestor of the PR head; otherwise report base drift and
   stop rather than rebasing or merging automatically.
3. Inspect draft state, mergeability/conflicts, review decision, required status rollup, unresolved
   review threads, and repository-required deployment or merge-queue state. An absent check is not a
   pass when repository policy requires that evidence.
4. Re-run the final deterministic repository commands against the exact head in the isolated checkout.
   Apply all repository safety contracts; report unsafe or unavailable required checks as missing
   evidence.
5. Freeze the exact base-to-head patch and run fresh Standards, Spec, and Knowledge reviewer passes.
   The Knowledge axis receives complete implementation context so it can detect missing durable
   guidance, not only review documentation that already exists.
6. Report `ready`, `not ready`, or `blocked by missing evidence`, bound to exact base/head SHAs. Never
   merge.

## Merge workflow (`/skill:pr merge`)

This mode is intentionally destructive after merge, but it must fail closed before the irreversible
step. A normal run targets the current branch and its registered linked worktree. A recovery run may
start from the primary or another surviving worktree that shares the receipt's validated common Git
directory when the recorded target worktree is already absent.

Before creating or resuming a receipt, acquire a repository-scoped discovery lock under the common Git
directory. Under that lock, resolve the current PR for a normal run or enumerate receipt filenames
keyed by immutable repository/PR identity for recovery; do not trust receipt contents before locking
the selected key. Acquire one exclusive, process-lifetime per-receipt lock before releasing discovery.
Use OS-released advisory locks or equivalent exclusive primitives with verified stale-owner handling,
and fail closed on live contention. Hold the per-receipt lock through merge and all cleanup so
concurrent invocations cannot duplicate requests or overwrite state. Under that lock, validate receipt
content against GitHub and Git identities. Resume post-merge cleanup only when the receipt already
contains authoritative success from this workflow's exact squash request. A `prepared` receipt whose PR
was merged without that response remains unresolved because a concurrent merge method cannot be
proven; retain it for manual disposition. An eligible receipt matching either the exact target
worktree or its proven absence resumes at the first incomplete milestone without requiring an open PR
or attempting another merge.

1. Establish the cleanup target before changing anything:
   - require a clean, registered linked worktree rather than the repository's primary checkout;
   - require a non-default local branch with one unambiguous open PR whose head branch and repository
     match the checked-out branch;
   - require local `HEAD`, the local branch ref, and the remote PR head to match exactly;
   - enumerate all registered worktrees and require that only the recorded target has a symbolic
     `HEAD` for the local branch, including checkouts created with `--ignore-other-worktrees`;
   - record the worktree administrative ID, canonical path, bidirectional `.git`/`gitdir` mapping,
     absolute common Git directory, primary checkout, GitHub source repository identity, pinned source
     push URL, full branch ref, and expected head SHA;
   - reject symlink/path identity ambiguity, verify the source ref at the pinned URL, and verify the
     source branch is not default/protected. Stop before readiness work if safe remote and local
     cleanup cannot be established.
2. Run the full Ready workflow. This includes Always-on preparation, repository validation,
   independent review, any required commit/push, managed-body update, and ready transition. Re-record
   the clean worktree state and exact local/remote head SHA after it completes.
3. Run the complete Pre-merge workflow against that exact remote head in isolated temporary state. It
   must report `ready`; `not ready` or missing evidence stops the merge.
4. Immediately before merging, re-query base/head SHAs, draft state, mergeability, required checks,
   reviews, unresolved threads, and repository-required deployment or queue state. If the base or head
   changed, the evidence is stale: rerun the affected Ready/Pre-merge gates. Detect merge-queue
   requirements before the merge call and stop if a queue applies; this mode supports only an
   immediate squash merge and never enables auto-merge or enqueues a PR.
5. Record a durable cleanup receipt under the common Git directory, outside the removable worktree.
   Include repository/PR identity, reviewed base/head, source repository and pinned URL, remote/local
   full refs, worktree administrative ID and path mappings, common Git directory, and lifecycle state.
   Persist milestones crash-durably: write and sync a temporary file, atomically replace the receipt,
   then sync its parent directory before the next destructive step. Use `prepared`, `merged`,
   `remote-deleted`, `worktree-removed`, and `local-ref-deleted`. Only a receipt containing the
   authoritative `merged` milestone from this workflow's direct successful squash response may resume
   automatic cleanup or bypass the open-PR requirement. A `prepared` receipt after an ambiguous
   response records context for manual disposition but never authorizes automatic cleanup.
6. Confirm the repository permits squash merging. Use GitHub's immediate merge API rather than
   `gh pr merge`, because the latter may implicitly enqueue or enable auto-merge on queue-protected
   branches. Supply `merge_method=squash` and the reviewed head SHA as the server-side head
   precondition. Do not use administrator bypass or another merge method:

   ```bash
   gh api --method PUT repos/<owner>/<repo>/pulls/<number>/merge \
     --raw-field merge_method=squash \
     --raw-field sha=<head-sha>
   ```

   GitHub does not offer an atomic expected-base precondition for this API. Re-query the base
   immediately before the call and require repository merge policy/checks to govern any server-side
   base movement during the request. Do not claim atomic exact-base binding. If the repository or user
   requires the merge to be locked to the audited base SHA, stop because this mode cannot guarantee
   that constraint through GitHub's API.

7. Treat only the direct response to this workflow's exact API request with `merged: true` as
   authoritative proof of the requested squash merge. Atomically persist that response, `mergedAt`,
   and merge commit before advancing the receipt. After an ambiguous or lost response, query the PR
   only to report current state; a later merged state does not prove this squash request won over a
   concurrent merge. Do not advance cleanup automatically—retain the branch/worktree and `prepared`
   receipt for manual disposition. If GitHub confirms the PR remains open and the request definitely
   failed, a later invocation may rerun readiness/audit before another merge attempt.
8. After confirmed merge, atomically delete the remote source branch only when it still points to the
   reviewed head SHA. Revalidate that the pinned push URL still identifies the recorded source
   repository; re-query the source repository's current default branch, protection, and applicable
   rulesets; and refuse deletion if the source branch is now default or protected. Query the exact full
   ref there, then push the deletion to that URL with mandatory
   `--force-with-lease=<full-ref>:<head-sha>`. Treat an already absent live ref as success. Never use an
   unguarded deletion or retry against a moved ref. If deletion fails, retain local recovery state and
   report that merge succeeded but cleanup is incomplete.
9. Re-enumerate every registered worktree and require that only the recorded target has a symbolic
   `HEAD` for the local branch. Revalidate its administrative ID, exact registered/canonical path,
   bidirectional path mapping, clean status, checked-out head, and local branch ref. Git provides no
   atomic identity lock
   spanning worktree verification and removal, so require exclusive local ownership of all worktree
   mutations under the common Git directory. The parent must be the sole writer, with no active async
   child or other Git/worktree mutator; if that exclusion cannot be established, stop and retain the
   receipt for manual cleanup rather than claiming concurrency safety.

   Run the guarded cleanup in one final shell operation from a stable directory outside the target,
   without launching other work. Open a `git update-ref --stdin` transaction that queues deletion of
   the full local branch ref at the expected SHA, then `prepare` it so Git holds and verifies the ref
   lock. While that transaction remains prepared:
   - re-check worktree identity and cleanliness;
   - remove the exact linked worktree without `--force` through the recorded common Git directory;
   - commit the prepared ref deletion only after removal succeeds, or abort it if removal fails.

   After worktree removal, atomically persist the `worktree-removed` milestone before committing the
   ref transaction, then persist `local-ref-deleted`. Do not run broad `git worktree prune`; remove only
   the recorded worktree and its own administrative entry. If the transaction or removal fails, never
   retry with force.

10. Recovery from either `remote-deleted` or `worktree-removed` must run from a surviving checkout with
    the same validated common Git directory. When both the recorded target path and administrative
    entry are absent, treat removal as proven even if a crash prevented its milestone write and
    durably advance to `worktree-removed`. Immediately before local ref deletion, re-enumerate every
    registered worktree and refuse deletion if any has a symbolic `HEAD` for that branch. If none does
    and the local ref still equals the receipt SHA, delete it with an expected-old-SHA transaction; if
    already absent, mark it complete; if moved, retain it and report the conflict. This recovery path
    never recreates or removes another worktree.
11. The final cleanup operation removes the durable receipt, syncs the receipt directory, and releases
    its lock only after every guarded milestone succeeds. After its tool call, make no further
    filesystem, Git, GitHub,
    validation, or subagent calls. Return the prepared final response directly so the session does not
    depend on a deleted working directory.

Report **merged** only when GitHub confirms the squash merge. Report the PR URL, reviewed base/head,
merge commit, remote branch deletion, local branch deletion, and worktree removal. Distinguish a
successful merge with incomplete cleanup from a fully completed merge; never hide the durable receipt
or residual recovery steps.

## Acceptance

Report **ready** only when:

- intent and diff scope are explicit, nonempty, and unambiguous;
- repository-required deterministic checks passed against unchanged content;
- when behavior changed or repository policy requires tests, applicable tests prove it at appropriate
  repository-defined seams; non-behavioral changes record tests as not applicable rather than inventing
  them;
- no blocker/high review finding remains and every medium finding is dispositioned;
- applicable migration, deployment, integration, and end-to-end requirements are satisfied safely or
  block readiness;
- repository-required or available formatting checks pass, or formatting is explicitly not applicable;
  the worktree contains no unreviewed change, and remote SHA matches evidence;
- base drift, conflicts, pending required checks, and unresolved mandatory feedback are absent.

Always report the PR URL, base/head SHAs, commands and outcomes, reviewer dispositions, skipped checks,
and residual risks. Do not claim that draft creation implies readiness.

## Anti-patterns

- Hardcoding one repository's package manager, runtime, scripts, stack, deployment provider, or paths
- Treating optional CI jobs or inferred local conventions as universal merge gates
- Running destructive, production, publish, or migration commands as routine validation
- Rewriting human-authored PR text or creating duplicate PRs
- Broad staging, hiding unrelated work, or silently discarding changes
- Claiming review or validation against content that changed afterward
- Marking a PR ready when required evidence is missing
- Merging outside `/skill:pr merge` or cleaning up before GitHub confirms the merge
