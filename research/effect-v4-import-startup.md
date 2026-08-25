# Effect v4 import startup investigation

Date: 2026-07-31

## Question

Is the `file-search` Pi extension using Effect v4, and is its startup cost characteristic of Effect v4?

## Conclusion

Yes. The extension requests Effect v4 beta and resolves to `effect@4.0.0-beta.102` plus `@effect/platform-node@4.0.0-beta.102`. The cloned upstream repository was also at `4.0.0-beta.102`.

The observed cost is specifically the cost of loading Effect v4's **barrel entry points in an unbundled Node process**, not evidence that every Effect v4 program is intrinsically slow. The upstream project supports and internally enforces direct module imports such as `effect/Effect`; those are substantially faster in a fresh Node process. Effect's tree-shaking claims apply to build-time bundling, while Pi loads the TypeScript extension and its dependencies at runtime.

## Versions and source snapshot

- Local declaration: [`home/pi/.pi/agent/extensions/file-search/package.json`](../home/pi/.pi/agent/extensions/file-search/package.json) requests `effect` and `@effect/platform-node` with `^4.0.0-beta.99`.
- Local lockfile: [`home/pi/.pi/package-lock.json`](../home/pi/.pi/package-lock.json) resolves both packages to `4.0.0-beta.102`.
- Official repository cloned to `/tmp/effect-v4-investigation`.
- Investigated commit: [`c9aa7d0fa8874178906329e3c3581ad785b67101`](https://github.com/Effect-TS/effect/tree/c9aa7d0fa8874178906329e3c3581ad785b67101).
- At that commit, [`packages/effect/package.json`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/effect/package.json#L4) declares `4.0.0-beta.102`.

Reproduce the clone:

```sh
git clone --depth=1 https://github.com/Effect-TS/effect.git /tmp/effect-v4-investigation
git -C /tmp/effect-v4-investigation rev-parse HEAD
```

## Why the barrel imports are expensive

At investigation time, `file-search` imported namespaces from the package roots in [`index.ts`](../home/pi/.pi/agent/extensions/file-search/index.ts) and [`src/binaries.ts`](../home/pi/.pi/agent/extensions/file-search/src/binaries.ts):

```ts
import { Cause, Data, Effect, Exit } from "effect"
import { NodeServices } from "@effect/platform-node"
```

The official v4 root is an auto-generated barrel. At the investigated commit:

- [`effect/src/index.ts`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/effect/src/index.ts#L32) contains 137 `export * as ...` namespace exports, including [`Cause`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/effect/src/index.ts#L67), [`Effect`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/effect/src/index.ts#L152), and [`FileSystem`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/effect/src/index.ts#L212).
- [`platform-node/src/index.ts`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/platform-node/src/index.ts#L5) exports 25 namespaces, including [`NodeHttpClient`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/platform-node/src/index.ts#L40) and [`NodeServices`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/platform-node/src/index.ts#L85).
- Both packages explicitly expose direct subpaths through `./*` package exports; see [`effect/package.json`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/effect/package.json#L51).

A fresh Node process must resolve, instantiate, and evaluate the reachable ESM graph. Named imports do not perform build-time tree-shaking. The package's `"sideEffects": []` metadata helps bundlers, but does not make Node prune barrel re-exports at runtime.

The 47 MB installed `effect` directory is **not** the amount loaded into memory. It includes TypeScript declarations, source maps, and many modules. Fresh-process import timings are the relevant evidence.

## Upstream's own import policy

The official repository contains a custom lint rule whose description is: “Disallow importing from barrel files (index.ts), encourage importing specific modules instead.” See [`no-import-from-barrel-package.ts`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/tools/oxc/src/oxlint/rules/no-import-from-barrel-package.ts#L74).

Its suggested fix is explicitly:

```ts
import * as Effect from "effect/Effect"
```

See [line 133](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/tools/oxc/src/oxlint/rules/no-import-from-barrel-package.ts#L133).

The root lint configuration extends that rule, and disables it only for tests, examples, benchmarks, bundles, scripts, and scratchpads. See [`.oxlintrc.json`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/.oxlintrc.json#L3) and the [rule patterns](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/packages/tools/oxc/oxlintrc.json#L12-L18). In production source, the repository has roughly 1,622 direct `effect/*` imports and only three root `effect` imports, all type-only and therefore erased.

This is strong first-party evidence that direct module imports are the intended production pattern inside Effect v4 itself.

## Benchmarks

Environment: Node `v24.18.1`, macOS arm64, fresh Node process per sample, 30 samples per case. Timings measure `await import(...)`, excluding Node process startup.

| Imports | Median | p90 |
|---|---:|---:|
| `effect` barrel | 138.3 ms | 245.4 ms |
| `effect/Effect` direct | 39.9 ms | 67.2 ms |
| `@effect/platform-node` barrel | 263.7 ms | 331.2 ms |
| `@effect/platform-node/NodeServices` direct | 118.2 ms | 184.0 ms |
| Current `file-search` Effect import set | 298.2 ms | 434.5 ms |
| Equivalent direct core/platform imports | 202.4 ms | 313.6 ms |

The direct-import prototype reduced actual Pi TUI startup from a 1.197 s median to 1.067 s. A bundle prototype was worse (1.570 s), because Node had to parse a generated 1.6 MB module eagerly.

Representative benchmark command:

```sh
cd /Users/magoz/.dotfiles/home/pi/.pi
node --input-type=module -e \
  'const t=performance.now(); await import("effect"); console.log(performance.now()-t)'

node --input-type=module -e \
  'const t=performance.now(); await import("effect/Effect"); console.log(performance.now()-t)'
```

Run each command in a fresh process; the full table used 30 repetitions and reported the median and p90.

## Tree-shaking nuance

Effect v4's migration guide says the package supports “aggressive tree-shaking” and that a minimal **bundled** program is about 6.3 KB minified and gzipped. See [`MIGRATION.md`](https://github.com/Effect-TS/effect/blob/c9aa7d0fa8874178906329e3c3581ad785b67101/MIGRATION.md#L53-L57).

That claim is compatible with these findings:

- A bundler can follow `sideEffects: []`, eliminate unused namespaces, and annotate pure calls.
- Pi/Jiti loads the extension as runtime modules; Node does not tree-shake that graph.
- Therefore an ergonomic barrel import can bundle well while still having higher cold-start cost when run directly by Node.

## Recommended changes

1. Replace package-root imports with direct v4 subpath imports. This is low risk and follows Effect's own lint policy.
2. Move binary installer and process runtime imports behind a dynamic import invoked on the first `fd` or `rg` execution. Keep the extension entrypoint limited to schemas, renderers, and tool registration.
3. Remove the awaited startup binary probe. Resolve system binaries lazily on first use; downloading a missing binary should never block Pi's initial TUI.
4. Do not commit a large bundle solely for startup performance; the tested bundle regressed startup.

Direct imports recover about 0.1–0.15 seconds. True lazy runtime loading should move nearly all of the remaining ~0.3-second Effect cost from Pi startup to the first search call while retaining the portable downloader.

## Implementation result

The extension was subsequently split into a lightweight registration entrypoint and a dynamically imported Effect runtime. In an 11-sample interactive TUI benchmark, the baseline median was 0.822 seconds and the lazy `file-search` median was 0.835 seconds—13 milliseconds apart and within run-to-run noise. Effect imports, binary probing, and fallback installation now begin only on the first `fd` or `rg` execution.
