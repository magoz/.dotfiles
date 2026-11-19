---
name: formal-verification
description: Model-check a concurrency protocol with TLA+ and everystate (no Java), replay every counterexample against the real code, and keep the model in step with the code. Use when a change adds or changes a claim, lease, lock, fence, single slot, retry, queue redelivery, outbox, cleanup or a write across stores; when a race or idempotency bug is suspected or keeps recurring; when asked to "model-check", "prove this invariant", "find race conditions" or "can these steps happen in a bad order"; or when code a model covers changed.
metadata:
  opencode/slash: 'true'
---

# Formal verification

A test checks the orders of events someone thought to write. A model checker checks every order of
the steps in a small model of the design. Use it where a promise depends on interleavings: two
requests, a retry beside the original, a crash between two writes, a timeout racing a commit.

It verifies the model, not the code. Its value comes from three disciplines this skill enforces:
model only steps that are atomic in the real system, show every property failing on a broken
variant, and replay every counterexample against the real code before calling it a bug.

## Authority

Repository policy comes from the repository. Before anything else, read the repository's own
formal verification guide if it has one (for example `patterns/FORMAL_VERIFICATION.md`, linked
from `AGENTS.md`): where models live, the manifest format, the check command, and the platform
assumptions (database isolation, queue and workflow delivery) every model must use. When the
repository has no guide, keep models in a scratch folder outside it and report; do not invent
repository structure.

## Modes

| Invocation                        | Does                                                              |
| --------------------------------- | ----------------------------------------------------------------- |
| `formal-verification [target]`    | Model: model one protocol, check it, replay, report (default)     |
| `formal-verification maintain`    | Re-check models whose covered code changed; update or report bugs |
| `formal-verification hunt [area]` | Audit existing code for unknown bugs; model the riskiest promises |

The target is a feature, folder, function or plan. With none, use the current task's change.

## Tool

`everystate` is a TLA+ model checker with TLC's language, `.cfg` files and exit codes, as one
binary. Prefer the repository's pinned copy (`pnpm exec everystate`), else `npx -y everystate`.

```sh
everystate -json Spec.tla                   # reads Spec.cfg; one JSON line on stdout
everystate -json -config Other.cfg Spec.tla # another configuration of the same spec
everystate -workers auto Spec.tla           # all cores, same results
everystate -simulate num=10000 Spec.tla     # random behaviours when too large to enumerate
```

Exit 0 means every reachable state was checked; 12 an invariant broke (the JSON has `name` and the
shortest `trace`); 11 deadlock; 13 liveness; 150/151 the spec or config does not parse. Run checks
in the foreground with a shell timeout; a configuration that needs minutes is too large to keep.

## Model mode

1. **Pick the promise.** One sentence the code keeps, where a break harms a user: "an answer is
   posted at most once", "one delivery starts at most one run". Take it from the code, its docs and
   ADRs; ask only what you cannot read. Prefer the strongest promise, not the easiest to model.
2. **List every writer, per value.** For each row, column, key or external resource the promise
   reads, search the code for every write to it (every `UPDATE`, `INSERT`, `DELETE`, upsert and
   external call that changes it), not only the writers of the protocol you started from. Include
   writers whose main job is elsewhere: a job that also stamps a counter or a status on a row it
   reads, a cleanup, a migration path, the other tab, the agent's tools beside the owner's actions,
   retries, redeliveries, Stop and deletes. Record the list in the report. A writer left out is an
   interleaving never checked; a writer that writes back a value it read earlier is the most common
   lost update.
3. **Cut the code into atomic steps.** One TLA+ action per step that is indivisible in the real
   system, never coarser:
   - One SQL statement is one step. A conditional `UPDATE ... WHERE` is a compare-and-set.
   - A transaction is one step only against writers its locks actually block (row locks it takes,
     `FOR UPDATE`, advisory locks). Under read committed, an unlocked read followed by a write is
     two steps, and so is reading a value in one statement and writing it back in a later one.
   - Each external call (platform start, object storage, provider API, socket message) is its own
     step, and it can succeed while the next step fails or the process dies.
   - Each `await` or `yield` in concurrent handlers is a step boundary; handlers interleave unless
     a queue or lock serializes them.
   - Timers, deadlines, leases and timeouts fire as steps; model time as a small counter.
   - At-least-once delivery: a step may run again after partial effects, or beside the original.
   - Crash at any step boundary, with what the crash leaves behind.
   Comment each action with the file and function it stands for, in the code's names.
4. **Bound it.** Two actors, one or two keys, a clock of a few ticks, one crash or retry. Most
   design bugs show at these sizes. Keep each kept configuration to seconds.
5. **State the properties.** A type invariant first (it catches modelling slips), then the promise
   as an `INVARIANT` ("never bad"). Use a `PROPERTY` with fairness only for "eventually good".
   Deadlines are promises too: for every wait with a timeout (a pickup, a lease, a step deadline,
   a poll window), state that the other side always serves it in time, model time in ticks of
   the code's real constants, and let time pass only when no event that the code handles at once
   is due. A protocol that is safe but makes a waiter time out under normal operation is a bug.
6. **Make it able to fail.** Add a constant that removes the guard the promise rests on (the fence,
   the lock, the conditional `WHERE`) and a configuration with it off that must break the
   invariant. If removing a guard breaks nothing, say what that teaches: the guard may be redundant,
   or another guard carries the promise. A check never seen failing proves nothing.
7. **Run and replay.** For each counterexample, walk the trace against the real code step by step,
   naming the line each action stands for. If a step cannot happen in the code, the model is wrong:
   fix the model and say what was wrong. If every step can happen, it is a bug. Reproduce it
   against the real code when a cheap test or script can (fakes, an injected yield, a test clock).
8. **Report** (below). Do not weaken a property or the model to get a pass, and do not change
   product code unless asked: a counterexample on the current code is a finding.

Start from what the repository already has: when a committed model (a `formal/` folder, or the
repository's equivalent) covers the code you are looking at, read it first and extend it with the
writers, steps or timings the change adds, rather than writing a new one. Keep a model in the
repository only for a subtle protocol whose code is fairly stable, and follow the repository's
manifest format: the covered files, a configuration that must pass and one that must fail, and the
repository's check command.

## Maintain mode

A model that still passes after its code changed is the dangerous case: it looks like proof of
code that no longer exists. For each model whose covered code changed (the repository's check names
them, for example a failing drift check on a pull request), whoever reviews the change runs this:

1. Run the model as it is and record the result.
2. Read every change to the covered code, and look for code that moved or new writers of the same
   state. Classify each change: no effect on what the model describes; the steps changed; the
   promise changed on purpose (cite the evidence: commit, doc, test); or the promise may be broken.
3. Update the model from the code, before rerunning, never from what makes it pass. Keep bounds
   unless the change makes them wrong, and say when you reduce one.
4. Rerun. A pass needs its must-fail configuration still failing. A failure gets replayed against
   the code: drift in the model, or a bug in the code (name the commit that introduced it).
5. Record the code as confirmed only after that (for example the repository's `--sync` command).

## Hunt mode

Audit existing code for unknown bugs. Map the area's promises first, every one the code, its
comments and docs make, including its timeouts and deadlines, then the writers of each value they
read (Model mode, step 2). Rank by the cost of a break and how poorly tests reach it, and model
them with Model mode until each listed promise is modelled or reported as left out with the
reason. When the area splits into several models, every writer of a value two models share
appears in both: a bug often sits exactly where one model's protocol writes what another's reads.
Report
candidates with a confidence: confirmed by replay against the code, plausible (depends on platform
behaviour you could not verify), or doubtful. Check documented accepted risks (ADRs, `AGENTS.md`,
comments) before reporting a behaviour as a bug, and quote them. A comment or README that promises
more than the code does is a strong lead.

## Report

For each model:

- The promise, the writers modelled, the files and functions each action stands for.
- Bounds and assumptions (isolation level, delivery semantics, timing), and what the model leaves
  out.
- The results: states checked, each property, and the guard-removal that made it fail.
- Each bug: the counterexample as numbered steps in the code's words with file and line, the harm
  in one sentence, the confidence and how it was replayed.
- Each place where the model, not the code, was wrong, and how it was fixed.

## TLA+ pitfalls

- Write `Next` as a disjunction of named actions so traces say which step ran.
- Every action states what it leaves `UNCHANGED`; a forgotten variable is unconstrained.
- `IF` / `CASE` inside `/\` lists binds loosely: wrap branches in parentheses when in doubt.
- `CHECK_DEADLOCK FALSE` when stopping is a legitimate end, or a `Done` action that stutters.
- Use model values (`Workers = {w1, w2}`) and `SYMMETRY` for interchangeable actors (safety only).
- Use 0 or a sentinel for SQL `NULL`, and keep clocks and counters bounded.
- `TLCGet`, `Print` and community modules are available; keep specs to standard modules when the
  repository runs them in CI.
