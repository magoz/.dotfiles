# Issue-Driven Agent Workflow

> Status: incubating design. This folder intentionally has no `SKILL.md`, so Pi does not discover or execute it as a skill yet.

## Goal

Develop a mostly agent-operated engineering workflow in which:

- vague reports and ideas can enter through an agent conversation;
- GitHub Issues preserve the evolving work record;
- agents gather evidence, reproduce claims, and clarify decisions;
- an authoritative agent brief marks work that is safe to delegate;
- larger work is decomposed into agent-sized GitHub sub-issues with real dependencies;
- implementation uses isolated writers, deterministic checks, focused review, and regular or stacked pull requests as appropriate;
- durable guarantees live in code, tests, lint, CI, and tool boundaries rather than prompt claims.

The workflow should remain lightweight for small fixes and expand only when uncertainty or scope requires it.

## Concise proposal

```text
1. REPORT
User gives a vague request to Pi
→ GitHub issue: `needs-triage`

2. TRIAGE
Read-only agent investigates and posts evidence
→ HITL only for `needs-info` or `needs-decision`

3. READY
Agent publishes an authoritative Agent Brief
→ Large work becomes sub-issues + dependencies
→ Implementable issues: `ready-to-implement`

4. IMPLEMENT
Local workflow claims via assignment
→ isolated worktree
→ one writer + regression tests

5. DELIVER
Open draft PR
→ regular PR, or stacked PRs for linear dependent issues
→ CI + parallel read-only reviews + one fix writer

6. COMPLETE
PR merges and closes issue
→ durable learnings become tests, rules, or project documentation
```

**Operating model:** Skills orchestrate locally, subagents perform bounded roles, GitHub stores state, CI enforces guarantees, and humans intervene only for genuine decisions or missing information.

## Core model

### An issue is an evolving case file

A GitHub issue can begin as a vague report. It does not need to be an implementation-ready contract at creation time.

| Artifact | Responsibility |
| --- | --- |
| Original issue body | Preserve the reporter's observation, request, and available reproduction details |
| Comments | Investigation evidence, reproduction results, questions, answers, and decisions |
| State label | Identify what kind of work should happen next |
| Latest approved Agent Brief | Authoritative current execution contract |
| Assignment | Claim/lock for an execution coordinator |
| Pull request | Implementation and validation evidence |

Working hypothesis: preserve the original body and publish the execution contract as a structured `## Agent Brief` comment. If a brief is revised, clearly mark the previous brief as superseded or otherwise make the newest authoritative brief unambiguous.

### Proposed lifecycle

```text
vague report or idea
        ↓
   needs-triage
        ↓
agent gathers evidence
  ├── missing reporter facts ──→ needs-info
  ├── product/domain decision ─→ needs-decision / human discussion
  ├── invalid or rejected ─────→ wontfix
  └── sufficiently understood
              ↓
  authoritative Agent Brief
              ↓
    ready-to-implement
              ↓
      assignment = claim
              ↓
 branch/worktree + draft PR
              ↓
 review + deterministic checks
              ↓
       ready PR → merged
```

These names are provisional. Do not create a large label vocabulary until the manual pilot demonstrates which states are operationally necessary.

## Intake and triage

Reports are expected to originate in an agent conversation, but they may be vague. The agent should not require the user to arrive with a specification.

A triage pass should:

1. Read the full report and existing discussion.
2. Inspect repository guidance and relevant code.
3. Check whether the behavior already exists or the report is redundant.
4. Reproduce or otherwise verify the claim when possible.
5. Establish a tight behavioral signal appropriate to the bug's difficulty.
6. Distinguish reporter facts from product or architectural decisions.
7. Ask one decision question at a time; discoverable facts should be investigated rather than asked.
8. Route as needed:
   - clear mechanical defect → draft an Agent Brief;
   - uncertain cause or reproduction → continue diagnosis;
   - ambiguous expected behavior → grill the decisions;
   - missing external facts → request specific information.
9. Recommend the next state and show evidence.
10. Publish GitHub mutations only through the trusted coordinator until broader mutation permissions are intentionally designed.

A full hard-bug diagnosis loop is not mandatory for every obvious defect. The evidence depth should be proportional to uncertainty, while readiness must never be asserted from the symptom alone.

## Agent Brief

The Agent Brief is behavioral and durable rather than a file-by-file implementation recipe.

Provisional shape:

```markdown
## Agent Brief

**Category:** bug / enhancement
**Summary:** one-line outcome

**Evidence:**
- reproduction or verification result
- relevant current behavior and known boundary

**Current behavior:**
What happens now.

**Desired behavior:**
What should happen, including meaningful edge cases.

**Acceptance criteria:**
- [ ] independently verifiable criterion

**Validation expectations:**
- behavioral seam or regression signal
- repository-required deterministic checks

**Out of scope:**
- adjacent behavior that must not change

**Open risks:**
- remaining uncertainty the implementation agent must not silently assume away
```

Implementation paths may appear in investigation comments as evidence. The durable brief should prefer behavior and interfaces because paths become stale.

## Decomposition

Decomposition occurs only after triage has established the work well enough to reason about its boundary.

```text
approved Agent Brief
  ├── fits one fresh writer context → implement the issue directly
  └── too large or independently deliverable parts exist
          ↓
     propose child issues
          ↓
     user/coordinator approves decomposition
          ↓
     create native sub-issues and dependency edges
```

Adapt useful ideas from Matt Pocock's `to-tickets` skill:

- tracer-bullet vertical slices;
- each child is independently demonstrable or verifiable;
- each child fits one fresh context;
- blockers represent genuine execution gates;
- wide refactors may require expand–migrate–contract sequencing;
- show the proposed breakdown before publishing it.

Required adaptations:

- Do not decompose work that is already agent-sized.
- Decomposed work must have a parent issue as its stable outcome contract.
- Keep hierarchy and blocking separate: siblings do not automatically block each other.
- Do not automatically apply `ready-to-implement` merely because tickets were created.
- Do not automatically claim or begin implementation.
- Avoid mandatory prefactoring tickets unless they can remain green, are independently verifiable, and materially reduce later risk.
- Include validation expectations and scope boundaries in every child brief.
- Treat a linear dependency chain as a possible stack, not a commitment to one.

## Pull requests and stacks

Issue topology and delivery topology are related but distinct:

- issue dependencies may form a graph;
- a stacked pull request is strictly linear;
- one independent issue normally maps to one regular PR;
- a linear chain of dependent, reviewable child issues may map to one PR stack;
- independent children should use separate PRs or separate stacks.

Stack rules under consideration:

- Every layer must be independently understandable and reviewable.
- Relevant tests travel with the behavior in each layer; do not defer all tests to a final layer.
- Foundational dependencies belong below their consumers.
- One writer advances a stack sequentially.
- Parallel writers use deliberate isolated worktrees and separate delivery lines.
- Lower-layer changes require cascading rebase and renewed confidence in affected upper layers.
- Stacks merge bottom-up.
- Stack choice belongs to execution preparation, after issue decomposition and fresh repository inspection.

GitHub's official stacked PR feature is in public preview. Afloat currently meets the Git/GitHub CLI prerequisites but does not have the `github/gh-stack` extension installed and has no checked-in CI workflow. Do not install or configure stacks until a naturally multi-layer pilot exists.

## Guarantees and agent roles

### Guarantees

Deterministic guarantees belong in:

- type checking;
- lint and structural rules;
- focused and regression tests;
- builds and guarded E2E checks;
- CI status;
- branch/repository enforcement where available;
- tool permissions and single-writer boundaries.

Agents provide investigation, judgment, implementation, and review. Their prompts do not themselves guarantee correctness.

### Provisional roles

Roles are conceptual; they are not yet final skill or agent definitions.

| Role | Responsibility | Mutation boundary |
| --- | --- | --- |
| Intake/triage coordinator | Maintain issue state, request evidence, publish briefs | GitHub issue comments/labels only |
| Investigator | Explore, reproduce, diagnose, report evidence | Read-only repository by default |
| Decision facilitator | Grill ambiguous product/domain choices | No code mutation |
| Decomposer | Propose child issues and dependencies | Reports to coordinator |
| Implementation writer | Implement one claimed issue or sequential stack | One worktree/delivery line |
| Standards reviewer | Review against repository guidance | Read-only |
| Spec reviewer | Review against Agent Brief | Read-only |
| Validator | Run appropriate deterministic checks and report evidence | Read-only except test artifacts if explicitly permitted |
| Knowledge reviewer | Propose durable tests/docs/ADR updates | Read-only proposal first |

Until the protocol is proven, the parent Pi session remains the sole GitHub mutator and normal implementation uses one writer per worktree.

## Workflow skills

### Issue reporting

Name: `report-issue`.

Initial v1 responsibilities:

- capture one observed problem as a minimal case file;
- search for and reuse clear duplicates;
- create the issue with provenance and `needs-triage`;
- optionally record that it may block another issue;
- continue through the canonical `triage-issue` procedure;
- establish the native blocker edge only after triage confirms a real delivery gate;
- stop without assignment or implementation.

### Issue triage

Name: `triage-issue`.

Initial v1 responsibilities:

- investigate and verify a report read-only;
- route to missing information or a human-owned decision;
- prepare an Agent Brief when the issue is executable;
- apply one evidence-backed workflow state;
- stop without assignment or implementation.

### Issue decomposition

Possible names: `slice-issue` or an adapted `to-tickets`.

Responsibilities may include:

- decide whether decomposition is needed;
- propose vertical child issues;
- establish native sub-issue and dependency relationships;
- identify—but not create—a possible PR stack.

### Issue implementation

Name: `implement-issue`.

Initial v1 responsibilities:

- fetch the full issue thread and authoritative brief;
- verify readiness, assignment, and blockers;
- claim the issue as the first write;
- create an issue-derived branch in an isolated worktree;
- coordinate one regression-first writer;
- verify local evidence;
- push and open one draft regular PR;
- stop before review or merge.

Stack delivery, parallel review, accepted-fix loops, ready-for-review transitions, and merging remain later workflow pieces.

## Compared with Matt Pocock's method

Matt provides a toolbox of user-invoked skills. This proposal connects similar capabilities into a GitHub state-driven lifecycle.

| Stage | Matt's method | This proposal |
| --- | --- | --- |
| Repository setup | `setup-matt-pocock-skills` creates tracker and domain configuration | Reuse existing project guidance; no mandatory setup |
| Vague report | `triage` categorizes, verifies, and grills if necessary | Same core idea, AFK-first through issue state |
| Contract | Agent Brief comment or extensive `to-spec` issue | Concise authoritative Agent Brief |
| Human interaction | Maintainer approves recommendations; `to-tickets` always quizzes | HITL only for missing information or genuine decisions |
| Ready state | `ready-for-agent` | `ready-to-implement` |
| Decomposition | `to-tickets` creates tracer-bullet tickets | Similar, but optional and only after triage |
| Parent relationship | Parent optional when starting from a conversation | Decomposed work always retains a parent outcome issue |
| Dependencies | Native blockers where possible | Same |
| Implementation | `implement` invokes TDD and review, then commits the current branch | Claim, isolated worktree, and one writer |
| Review | Parallel spec and standards reviews | Same axes plus validation and a controlled fix loop |
| Delivery | Mostly stops after commit | Draft PR, CI, regular or stacked PRs, and merge lifecycle |
| Guarantees | Checks encouraged by workflow skills | CI and tool boundaries are explicit system components |

Matt's typical flow:

```text
setup
→ triage or to-spec
→ to-tickets
→ implement
   ├── tdd
   └── code-review
→ commit
```

Proposed flow:

```text
vague issue
→ autonomous triage
→ concise Agent Brief
→ optional decomposition
→ ready-to-implement
→ claim + isolated implementation
→ PR/stack + CI + review
→ merge
```

Borrow:

- issue tracker as durable memory;
- vague reports as valid input;
- verification before readiness;
- grilling only when needed;
- Agent Brief as execution contract;
- tracer-bullet child issues and native dependency edges;
- parallel spec and standards review.

Adapt:

- one continuous lifecycle rather than loosely connected commands;
- AFK operation by default;
- action-oriented state names;
- optional decomposition with a required parent outcome issue;
- existing repository knowledge rather than mandatory `CONTEXT.md`;
- explicit assignment and worktree ownership;
- PRs, stacks, CI, and merge as part of the lifecycle;
- one trusted coordinator for GitHub mutations initially.

## Wayfinder escalation

Wayfinder addresses a different problem from the normal lifecycle: it clears uncertainty before implementation can be specified. Use it only when triage finds an effort too large or foggy to produce an authoritative Agent Brief.

```text
needs-triage
    ↓
Can an Agent Brief be produced?
├── yes → Agent Brief
└── no, effort is large and foggy
          ↓
       Wayfinder
          ├── AFK research
          ├── HITL decision grilling
          ├── prototypes
          └── prerequisite tasks
          ↓
       route understood
          ↓
       Agent Brief
          ↓
   optional implementation decomposition
          ↓
     ready-to-implement
```

Wayfinder creates a map issue whose child tickets resolve decisions. It may deliberately leave future questions in a "Not yet specified" fog until earlier answers make those questions precise.

Keep its tickets distinct from implementation issues:

```text
Wayfinder child ticket
→ closes when a question is answered

Implementation child issue
→ closes when its PR merges
```

Wayfinder is therefore an optional pre-brief escalation from triage, not part of the normal path and not a replacement for implementation decomposition. Defer adapting it until a real issue proves too foggy for ordinary triage.

## Afloat pilot: Issue #4

Issue: <https://github.com/magoz/afloat/issues/4>

Report: the expense editor opens a native payment-date picker instead of Afloat's shared calendar.

Evidence gathered so far:

- `PaymentStatus` uses a hidden `<input type="date">` and calls `showPicker()`.
- The expense-list payment dialog already uses Afloat's shared `Calendar` inside a `Popover`.
- Repository rules and relevant UI/expense guidance were inspected.

Pilot results so far:

- `triage-issue` completed from static evidence, posted an authoritative Agent Brief, and moved the issue to `ready-to-implement` without unnecessary HITL.
- `implement-issue` claimed the issue, created `fix/4-shared-payment-date-calendar` in `/Users/magoz/dev/core-projects/afloat2-issue-4`, added regression coverage, and committed the implementation as `7d80afa`.
- Focused regression coverage, type checking, and lint passed.
- The full suite exposed a failure reproduced unchanged on `main`, confirming it is a baseline failure unrelated to Issue #4.
- The initial skill policy preserved the clean worktree and commit but incorrectly blocked both the remote branch push and draft PR.

Current state: Issue #4 remains open, assigned, and `ready-to-implement`. Commit `7d80afa` is pushed on `fix/4-shared-payment-date-calendar`, and draft PR #5 records the passing changed-scope checks plus the proven clean-base failure. Issue #6 captures that baseline failure and natively blocks Issue #4. Review and merge have not started.

Pilot correction: coherent inspected commits should be pushed for remote preservation. A draft PR may open when changed-scope validation passes and any remaining full-suite failure is proven identical on the clean base and documented prominently.

## Decisions so far

- GitHub may receive vague reports; issues do not need to begin implementation-ready.
- `report-issue` is the explicit intake surface: it creates a minimal case file and continues through canonical triage rather than leaving new reports stranded.
- Requested blocker edges are established only after triage confirms a real delivery gate; reporting alone does not make a dependency true.
- A nested skill's terminal state ends that stage, not its parent wrapper; wrappers must preserve and verify pending continuation obligations explicitly.
- Native issue dependencies use GitHub's standard API through `gh api`; they do not require the `gh-stack` extension.
- The issue thread is an evolving case file.
- The latest authoritative Agent Brief becomes the execution contract.
- When evidence is sufficient and no human decision remains, triage may publish the Agent Brief and move the issue to `ready-to-implement` autonomously.
- Human conversation occurs only at genuine HITL boundaries such as `needs-info` or `needs-decision`.
- Evidence and discussion remain visible in comments.
- Publishing an issue does not trigger implementation.
- Assignment is an execution claim, not an intake action.
- Diagnosis depth is proportional to uncertainty, but readiness requires evidence.
- Grilling is used when expected behavior or domain decisions are ambiguous, not for every bug.
- Decomposition is optional and follows triage.
- Native sub-issues represent hierarchy; native dependencies represent blocking.
- Stacked PRs are an optional linear delivery strategy, not the issue model.
- Tests and deterministic checks enforce guarantees; reviewers contribute judgment.
- Remote branch preservation is separate from merge readiness: push coherent inspected commits even when a full-suite baseline failure exists.
- A proven pre-existing failure may be documented in a draft PR, but it blocks ready-for-review and merge until explicitly dispositioned.
- Start manually and preserve one trusted GitHub coordinator.
- Matt Pocock's skills are inspiration; do not run `setup-matt-pocock-skills` or adopt its domain-doc hierarchy unchanged.
- Avoid Projects, hooks, autonomous schedulers, and broad label taxonomies until the protocol demonstrates a need.

## Open questions

1. What is the smallest useful state vocabulary?
2. Should readiness be represented only by labels, or by label plus a machine-readable Agent Brief marker?
3. How should revised briefs supersede old briefs without ambiguity?
4. When should a long investigation publish its issue: immediately, after first evidence, or according to a duration/complexity threshold?
5. Should triage be one coordinator skill routing bounded agents, or several directly invoked skills?
6. Which tracker mutations can eventually be delegated safely?
7. When does a parent issue become ready, and when do only its children become ready?
8. How should completion of all child issues close or resolve the parent?
9. What precise evidence makes a UI bug ready to implement when native browser behavior is difficult to automate?
10. How should `gh-stack` interact with the existing worktree-based writer isolation model?
11. Which parts of project `conform`, `tidy`, and `learn` become CI, reviewer agents, or retained skills?
12. Which workflow concepts should be global and which should remain project-specific?

## Inspiration

- Matt Pocock `triage`: vague issue → verification/grilling → Agent Brief → readiness state.
- Matt Pocock `AGENT-BRIEF.md`: behavioral, durable execution contracts.
- Matt Pocock `to-tickets`: tracer-bullet decomposition and native dependency edges.
- Matt Pocock `diagnosing-bugs`: build a tight red-capable feedback loop before hypothesizing on hard bugs.
- Matt Pocock `grill-with-docs`: one-question-at-a-time decision stress-testing plus domain modeling.
- GitHub Issues: sub-issues and native dependencies.
- GitHub stacked pull requests and the official `github/gh-stack` CLI extension.
- Pi subagents: fresh contexts, parallel read-only review, bounded tools, and single-writer coordination.

## Evolution log

### 2026-08-01

- Established Issue #4 as the first Afloat issue-intake pilot.
- Initially modeled an issue as a finished contract, then revised the model: an issue may start vague and evolve through evidence into an authoritative Agent Brief.
- Separated triage from optional decomposition.
- Recorded stacked PRs as a later execution choice rather than an intake requirement.
- Agreed on `ready-to-implement` as the implementation queue state.
- Made the normal lifecycle AFK-first: conversation resumes only for genuine HITL boundaries.
- Positioned the design as a GitHub state-driven evolution of Matt Pocock's user-invoked engineering skill toolbox.
- Positioned Wayfinder as an optional pre-brief escalation for large, foggy efforts; its decision tickets remain distinct from implementation issues.
- Named the ready-issue-to-draft-PR workflow `implement-issue`.
- Implemented initial executable `triage-issue` and `implement-issue` skills; both remain explicitly invoked and await further real-world calibration.
- Ran both skills against Issue #4. The implementation pilot exposed an overly strict required-check gate that left a coherent commit local-only.
- Separated remote preservation and draft-PR evidence from ready-for-review/merge gates; characterized baseline failures no longer block branch push or a draft PR.
- Resumed the preserved Issue #4 delivery under the corrected policy: pushed commit `7d80afa` and opened draft PR #5 with the clean-base failure documented; review and merge remain blocked.
- Added executable `report-issue` as a thin intake coordinator that deduplicates, creates a minimal case file, reuses `triage-issue`, and establishes an optional native blocker only after verification.
- Piloted `report-issue` to create and triage Issue #6. The nested triage stage initially ended the wrapper before dependency creation; strengthened the continuation invariant and verified the native `#6 blocks #4` edge in both directions.
