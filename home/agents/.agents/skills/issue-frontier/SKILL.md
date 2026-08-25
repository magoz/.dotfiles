---
name: issue-frontier
description: Inspect a decomposed GitHub parent issue and compute which child issues can safely start now on the default branch or as trusted stacked PRs. Produces bounded parallel launch commands but never mutates GitHub or creates worktrees.
disable-model-invocation: true
metadata:
  opencode/slash: "true"
  opencode/autoinvoke: "false"
---

# Issue Frontier

Compute the live executable frontier for one parent outcome issue.

Explicit invocation:

```text
/skill:issue-frontier <parent-issue-number-or-url>
```

This skill is read-only. It does not claim issues, launch Pi sessions, create worktrees, mutate stacks, or wait for implementations. It emits exact `implement-issue` commands that the user can run in separate clean launcher Pi sessions.

## Why separate launchers are required

A successful `create_worktree` handoff terminates its source Pi after starting the issue-owned destination Pi. One coordinator Pi therefore cannot safely loop over or concurrently call `create_worktree` for a frontier. Parallel execution uses one independent launcher Pi per admitted child, and every launcher must start from the repository parent workspace/main checkout rather than a linked worktree.

## Hard boundaries

Never:

- trust `ready-to-implement` by itself;
- trust a stale decomposition comment, branch name, PR body, or issue order as stack authority;
- mutate GitHub, assign issues, create branches/worktrees, run provisioning, or launch subagents;
- recommend launching an issue with another assignee, existing delivery artifacts, unresolved decisions, or ambiguous ownership;
- call an open blocker satisfied merely because a PR exists;
- treat an unreviewed or moved lower PR as stack-ready;
- synthesize a multi-head join;
- recommend more concurrent launches than the user/environment can safely support;
- automatically retry any launch after assignment, branch, worktree, or PR artifacts appear.

## 1. Resolve the parent and topology

- Require one open GitHub parent issue in the current repository.
- Read its complete body, comments, labels, assignees, native dependencies, native sub-issues, linked PRs, and authoritative `## Agent Brief`.
- Require the parent to remain unassigned with no implementation workflow-state label, issue-derived branch, worktree, or PR. If parent delivery is active, classify every child non-admissible and stop.
- Find the newest non-superseded coordinator-authored block delimited by:

```text
<!-- slice-issue:delivery-topology:v1:start -->
<!-- slice-issue:delivery-topology:v1:end -->
```

- Fetch comment database ID, author, created/updated timestamps, parse the JSON, serialize it as RFC 8785 JCS UTF-8, and compute lowercase hexadecimal SHA-256 over those exact bytes.
- Enforce the normative schema from `slice-issue`: exact root/node keys and JSON types, sorted unique/full current child set, supported merge/launch enums, in-parent references, exact native `blocked_by` match, no duplicate/self/cycle in the union graph, consistent launch-mode/stack mapping, and no ambiguous multi-head join.
- If any stack edge exists, require `merge_strategy: "merge-commit-required"` and confirm the repository currently allows merge commits.
- Stop if the block is missing, malformed, stale, edited by an unexpected actor, contradicted by later comments, omits/duplicates a child, contains unknown fields, or violates any graph invariant. Older decompositions without a v1 block must be re-published or explicitly migrated through `slice-issue`; do not infer topology.

## 2. Inspect every child live

For each child, read:

- state, labels, assignees, workflow-state labels, and authoritative Agent Brief;
- native blockers and blocking issues;
- local/remote issue-derived branches and worktrees;
- linked/open PRs and closing references;
- topology node fields: `blocked_by`, `stack_on`, `launch_mode`, and `parallel_group`.

For each proposed stack base, recursively verify:

- same repository and workflow-created lower PR whose state is `OPEN`;
- lower issue, expected assignment, branch, clean writer-free worktree, and live ownership agree;
- exactly one coordinator-authored `review-pr:status:v2` comment exists and its current monotonic record contains PR number, canonical repository, target ref, lower PR identity, target-tip, effective diff-base, head, sequence, and status;
- its author is the authenticated workflow owner, status is currently positive rather than `blocked`/`invalidated`, no active restack/mutation journal exists, and its head equals the current lower head;
- `ready` corresponds to a current non-draft default-based PR with applicable checks passing; `stack-ready` corresponds to a current draft trusted-stacked PR with applicable checks passing;
- the lower PR's own stack block/topology edge is intact when it is stacked;
- every open blocker of the candidate appears in that reviewed ancestor lineage and every other blocker is closed.

## 3. Classify the frontier

Classify each child into exactly one state:

### `default-ready`

All of these hold:

- issue is open, unassigned, `ready-to-implement`, and has no conflicting workflow label;
- authoritative Agent Brief is current and decision-free;
- every native blocker is closed;
- no branch, worktree, or PR already represents it;
- launch mode allows default-base delivery, or its former stack predecessor PR is MERGED with the exact trusted reviewed head preserved as an ancestor of freshly fetched default, all native blockers are closed, and the topology's stack edge therefore safely falls back to default delivery. Closed-but-unmerged predecessors require a topology revision.

Launch command:

```text
/skill:implement-issue <child-issue-url>
```

### `stack-ready`

All of these hold:

- issue-level readiness and artifact checks above pass;
- topology names one exact direct `stack_on` child;
- that child's current PR and ancestor lineage pass exact review-attestation, topology-digest, merge-policy, draft-state, and current-check checks;
- every open blocker is represented in the one reviewed lower lineage;
- launch mode is `stack-after-reviewed-base`.

Launch command:

```text
/skill:implement-issue <child-issue-url> --stack-on <lower-pr-url>
```

### `waiting-for-merge-join`

The child needs changes from multiple sibling heads that are not contained in one approved reviewed ancestor lineage. It must wait for all blockers to merge/close and then become `default-ready` from freshly fetched default.

### `waiting-for-review`

The topology permits stacking, but the lower PR is missing an exact current `ready`/`stack-ready` attestation or its tuple moved.

### `blocked`

A blocker is open and neither safely represented in an approved lower lineage nor eligible for stack admission.

### `active-or-owned`

The issue is assigned or already has a branch, worktree, or PR. Report the owner/artifact; never recommend a duplicate launch.

### `not-ready`

The issue is closed, lacks readiness/brief, has a conflicting workflow state, or needs a human decision.

## 4. Build a bounded parallel launch plan

- Group eligible nodes by `parallel_group` and shared resource risk.
- Parallel children must use separate branches, worktrees, writers, environments, and sandbox leases.
- Never place two children that mutate the same route/domain files or share a non-isolated external resource in the same launch wave merely because the topology labels them parallel.
- Respect any user-supplied concurrency cap. Otherwise recommend a conservative maximum based on machine, Vercel, sandbox database, and test constraints; ask the user when capacity is unknown.
- A fan-out stack is valid: multiple children may independently stack on one unchanged reviewed lower PR.
- Merges remain serialized. After any lower PR or sibling merge, recompute the frontier and revalidate affected review tuples.

Because this Pi cannot survive multiple successful handoffs, output one command per separate launcher session. Do not execute them here.

## 5. Report

Return:

- parent URL and topology comment URL;
- each child classification and reason;
- default-ready and stack-ready frontiers;
- safe parallel groups and recommended concurrency;
- merge-gated joins;
- exact one-shot launch command for each admitted child;
- active ownership/artifacts and recovery warnings;
- explicit statement that no GitHub, branch, worktree, PR, environment, or infrastructure mutation occurred.
