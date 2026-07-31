# Pi extension development guidance

## Treat startup performance as an invariant

Pi loads extension entrypoints and awaits their factories **sequentially**, in load order. Startup event handlers such as `session_start` also run sequentially. Expensive work is not hidden behind parallel extension loading: one slow extension delays the TUI and every extension after it, while multiple slow extensions can accumulate.

When creating or modifying an extension:

1. Keep its entrypoint limited to lightweight registration, schemas, prompt metadata, renderers, and small configuration reads.
2. Do not probe binaries, start processes, access the network, scan the filesystem, or initialize heavy runtimes during module evaluation.
3. Avoid an async factory unless the result must exist before Pi can finish startup.
4. Do not await optional setup from `session_start`.
5. Dynamically import expensive implementation modules from the command, tool, or event that first needs them.
6. Cache the dynamic import so concurrent and later calls share one runtime instance.

Typical structure:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Runtime = import("./src/runtime.ts").Runtime;

export default function extension(pi: ExtensionAPI) {
  let runtimePromise: Promise<Runtime> | undefined;
  const loadRuntime = () =>
    (runtimePromise ??= import("./src/runtime.ts").then(
      ({ createRuntime }) => createRuntime(),
    ));

  pi.registerTool({
    // Register synchronously so the tool is immediately available.
    async execute(/* ... */) {
      const runtime = await loadRuntime();
      return runtime.execute(/* ... */);
    },
  });
}
```

Type-only references to the runtime are erased and do not load it. Do not replace them with static runtime imports or static re-exports: ESM re-exports also evaluate the target module.

Long-lived resources should follow Pi's documented lifecycle: start them from `session_start` or the command/tool/event that needs them, and close session-scoped resources from an idempotent `session_shutdown` handler. Prefer first-use startup when the resource is optional.

## Effect v4 import rules

Effect v4 root imports are expensive in unbundled Node/Jiti execution because they are large namespace barrels. Effect's bundler tree-shaking claims do not apply to Pi's runtime extension loading.

Avoid runtime imports like:

```ts
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
```

Use direct subpath namespace imports inside lazily loaded implementation modules:

```ts
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as NodeServices from "@effect/platform-node/NodeServices";
```

Effect's own production lint policy recommends direct subpaths. They reduce first-use cost and avoid evaluating broad barrels.

Some unstable v4 namespaces, including `effect/unstable/http` and `effect/unstable/process`, are exported only as grouped barrels. Keep those imports behind a dynamic runtime boundary.

Before adding Effect to a new extension, consider whether native promises and Node APIs are sufficient. If Effect is useful, keep the entire Effect-dependent graph out of the extension entrypoint.

## Lazy initialization and cancellation

Be careful when a tool's first-use initialization is both cached and cancellable. Caching an Effect under the caller's abort signal can permanently cache an interrupted result. Later uncancelled calls then fail as if they had also been cancelled.

`file-search/src/runtime.ts` provides the reference pattern: `cacheDetached` starts bounded initialization in an independent root fiber and caches its promise. Callers can stop waiting without cancelling or poisoning shared initialization.

Use this pattern when initialization should happen once and may outlive an individual waiter:

- concurrent first calls share one initialization;
- cancellation returns promptly for that waiter;
- later calls receive the eventual cached success or real setup failure;
- initialization must have its own probe, network, process, and extraction timeouts.

The tradeoff is intentional: bounded setup may continue in the background after the triggering operation is cancelled. Do not detach unbounded work.

If cancellation should terminate initialization and allow a clean retry instead, use an explicit state machine that clears the cached promise after interruption rather than caching the interrupted exit.

## Notifications and errors

Optional setup should not emit notifications during every Pi startup.

- Report setup failures when the feature is first used.
- Do not report user cancellation as setup failure.
- Deduplicate notifications when initialization is shared.
- Keep successful common paths silent.
- Notify only for meaningful state changes, such as installing a missing dependency.
- Preserve cancellation signals and throw tool execution errors so Pi marks results correctly.

## Testing startup boundaries

A lazy-loading refactor needs a regression test; code review alone will not prevent a future static import from reconnecting the expensive graph.

`file-search/index.spec.ts` demonstrates a behavioral import guard:

1. Spawn a fresh Node process.
2. Install an ESM loader that rejects imports from the heavy dependency.
3. Import the extension entrypoint.
4. Invoke its factory and verify expected tools or commands register.

This proves import plus registration remains lightweight. Prefer this over source-text matching or timing thresholds.

Also test:

- concurrent first use shares initialization;
- cancellation cannot poison a cache;
- real setup failures remain cached or retry according to the intended policy;
- notification deduplication;
- command/tool smoke execution through the registered public interface;
- cleanup after interruption, timeout, and nonzero process exits.

Each extension should expose `check` and `test` scripts when practical. For workspace extensions, run:

```sh
npm --prefix pi/.pi run check --workspace=<extension-name>
```

Run the extension's test suite from its workspace directory, then smoke-test through the registered Pi interface when changing the dynamic import boundary.

## Benchmarking extension startup

Use fresh Pi processes and isolate one extension:

```sh
pi --offline --no-session --no-extensions --no-skills \
  --no-prompt-templates --no-themes --no-context-files \
  -e /absolute/path/to/extension/index.ts
```

Compare against the same command without `-e`. Use multiple samples and medians from the same run; startup variance makes individual measurements and cross-run means misleading.

Also measure the normal full extension set. Costs are broadly additive because loading is sequential, but shared module caches and fixed startup work mean isolated contributions will not sum exactly.

Useful experiments when diagnosing a heavy extension:

1. Baseline without the extension.
2. Empty entrypoint with only registration imports.
3. Heavy dependency imports without extension logic.
4. Direct package subpaths versus package-root barrels.
5. Lazy runtime import.
6. Bundle prototype—but retain it only if measured faster.

Do not assume bundling improves startup. A bundle can be slower when Node must eagerly parse one large generated module.

## Monolithic packages and Pi's loader

Pi loads extension entrypoints through Jiti, including JavaScript packages. Native Node import timings therefore do not predict Pi extension timings for a large generated file or a broad TypeScript graph.

Two external-package investigations illustrate the failure modes:

- `pi-vimmode` 0.9.0 ships one 233 KB minified JavaScript bundle. Pi/Jiti loaded that file natively, so its peer imports bypassed Pi's host aliases and evaluated another copy of the Pi SDK from `~/.pi/node_modules`. With those dependencies already loaded, native Node imported the bundle in about 10 milliseconds; with the duplicate SDK path, full Pi timing samples reached roughly 0.8–1.15 seconds. Unminifying did not address the duplicate import. `pi-vimmode-loader` keeps the package installed but filters its native entrypoint, materializes the exact bundle and relative release assets into a content-addressed `.ts` path in a user-private cache, and delegates registration through Jiti so host aliases apply. After the one-time transform, its median extension cost was about 23 milliseconds. The upstream project also tracks true-cold import and registration in [pi-vimmode #83](https://github.com/pekochan069/pi-vimmode/issues/83) and lazy lifecycle fallback compilation in [#93](https://github.com/pekochan069/pi-vimmode/issues/93).
- `pi-subagents` 0.37.2 eagerly loaded 133 TypeScript modules during registration. Its loader-harness median was about 143–222 milliseconds depending on run conditions, matching its roughly 0.2–0.3 second full Pi contribution. Version 0.38.0 retained the same eager graph and timing class.

A tiny async wrapper does not help when Pi awaits the wrapper factory or startup handler; it only relabels import time as factory or lifecycle time. Loading a required editor or lifecycle runtime in an unawaited background task can make the prompt appear sooner, but introduces a race where the feature is temporarily unavailable and startup events may be missed. Do not use that tradeoff silently.

For substantial packages, design the lightweight entrypoint before the graph becomes monolithic: keep registration definitions in a shallow module, split independent optional features, and make lifecycle state capable of replaying or safely awaiting initialization. If a feature must replace the editor before first input, optimize its import graph or loader path upstream rather than pretending it is optional first-use work.

## `file-search` reference results

`file-search` is the reference implementation for these practices:

- lightweight synchronous registration in `file-search/index.ts`;
- dynamically imported Effect runtime in `file-search/src/runtime.ts`;
- direct Effect v4 subpath imports;
- no binary probing or installation from `session_start`;
- per-tool first-use resolution;
- cancellation-safe detached caching;
- import-graph and cache-poisoning regression tests.

Measured with fresh interactive Pi processes and only the tested extension enabled:

| Configuration | Median startup |
|---|---:|
| Pi baseline | 0.822 s |
| Original eager `file-search` | 1.168–1.197 s |
| Direct Effect imports only | 1.067 s |
| Lazy `file-search` | 0.835 s |
| Bundled experiment | 1.570 s |

The lazy boundary reduced `file-search` startup contribution from roughly 0.3–0.35 seconds to about 13 milliseconds, within run-to-run noise. The bundle was slower because Pi eagerly parsed a large generated module.

Other local reference patterns:

- `ask-user` removed Effect entirely. Effect had only wrapped one UI promise, while the UI already accepted an `AbortSignal`. Native promise handling preserved cancellation and reduced median isolated import time from about 272 milliseconds to 20 milliseconds. Do not introduce a heavy runtime for behavior already covered clearly by platform APIs.
- `web-tools` separates lightweight tool definitions from execution modules. `webfetch-definition.ts` and `websearch-definition.ts` own schemas, prompt metadata, and renderers; `index.ts` registers proxy tools and dynamically imports `webfetch.ts` or `websearch.ts` on first execution. This keeps HTML parsers, network clients, and providers out of registration while preserving immediate tool availability. Median isolated import time fell from about 133 milliseconds to 23 milliseconds.

When an execution module already combines behavior and rendering, extract a lightweight definition object and spread it into both the eager proxy and real tool. This avoids duplicating schemas or renderers while preserving the lazy runtime boundary.

## New extension checklist

Before considering a new extension complete:

- [ ] Entry import and factory contain no optional heavyweight work.
- [ ] Expensive dependency graphs are behind cached dynamic imports.
- [ ] Effect uses direct subpaths and stays outside the entrypoint graph.
- [ ] Optional resources initialize on first use and have explicit timeouts.
- [ ] Cancellation semantics for cached initialization are tested.
- [ ] Session-scoped resources have idempotent shutdown cleanup.
- [ ] Import plus registration has a behavioral regression test.
- [ ] Type checks, tests, and a registered-interface smoke test pass.
- [ ] Startup contribution is measured against a same-run baseline.
