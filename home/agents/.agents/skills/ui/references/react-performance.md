# React and Next.js performance (Vercel)

Source: Vercel Engineering's React Best Practices. One file per rule in
[react-performance/](react-performance/), named `<rule>.md`; each has why it matters plus incorrect
and correct examples. Section impacts: [react-performance/_sections.md](react-performance/_sections.md).

If the project uses React Compiler, skip manual memoization and JSX hoisting rules.

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Eliminating waterfalls | CRITICAL | `async-` |
| 2 | Bundle size | CRITICAL | `bundle-` |
| 3 | Server-side performance | HIGH | `server-` |
| 4 | Client-side data fetching | MEDIUM-HIGH | `client-` |
| 5 | Re-render optimization | MEDIUM | `rerender-` |
| 6 | Rendering performance | MEDIUM | `rendering-` |
| 7 | JavaScript performance | LOW-MEDIUM | `js-` |
| 8 | Advanced patterns | LOW | `advanced-` |

## 1. Eliminating waterfalls

- `async-defer-await` - Move await into branches where actually used
- `async-parallel` - Use Promise.all() for independent operations
- `async-dependencies` - Use better-all for partial dependencies
- `async-api-routes` - Start promises early, await late in API routes
- `async-suspense-boundaries` - Use Suspense to stream content

## 2. Bundle size

- `bundle-barrel-imports` - Import directly, avoid barrel files
- `bundle-dynamic-imports` - Use next/dynamic for heavy components
- `bundle-defer-third-party` - Load analytics/logging after hydration
- `bundle-conditional` - Load modules only when feature is activated
- `bundle-preload` - Preload on hover/focus for perceived speed

## 3. Server-side performance

- `server-cache-react` - Use React.cache() for per-request deduplication
- `server-cache-lru` - Use LRU cache for cross-request caching
- `server-serialization` - Minimize data passed to client components
- `server-parallel-fetching` - Restructure components to parallelize fetches
- `server-after-nonblocking` - Use after() for non-blocking operations

## 4. Client-side data fetching

- `client-swr-dedup` - Use SWR for automatic request deduplication
- `client-event-listeners` - Deduplicate global event listeners
- `client-passive-event-listeners` - Use passive listeners for scroll/touch
- `client-localstorage-schema` - Version and validate localStorage data

## 5. Re-render optimization

- `rerender-defer-reads` - Don't subscribe to state only used in callbacks
- `rerender-memo` - Extract expensive work into memoized components
- `rerender-dependencies` - Use primitive dependencies in effects
- `rerender-derived-state` - Subscribe to derived booleans, not raw values
- `rerender-functional-setstate` - Use functional setState for stable callbacks
- `rerender-lazy-state-init` - Pass function to useState for expensive values
- `rerender-transitions` - Use startTransition for non-urgent updates

## 6. Rendering performance

- `rendering-animate-svg-wrapper` - Animate div wrapper, not SVG element
- `rendering-content-visibility` - Use content-visibility for long lists
- `rendering-hoist-jsx` - Extract static JSX outside components
- `rendering-svg-precision` - Reduce SVG coordinate precision
- `rendering-hydration-no-flicker` - Use inline script for client-only data
- `rendering-activity` - Use Activity component for show/hide
- `rendering-conditional-render` - Use ternary, not && for conditionals

## 7. JavaScript performance

- `js-batch-dom-css` - Group CSS changes via classes or cssText
- `js-index-maps` - Build Map for repeated lookups
- `js-cache-property-access` - Cache object properties in loops
- `js-cache-function-results` - Cache function results in module-level Map
- `js-cache-storage` - Cache localStorage/sessionStorage reads
- `js-combine-iterations` - Combine multiple filter/map into one loop
- `js-length-check-first` - Check array length before expensive comparison
- `js-early-exit` - Return early from functions
- `js-hoist-regexp` - Hoist RegExp creation outside loops
- `js-min-max-loop` - Use loop for min/max instead of sort
- `js-set-map-lookups` - Use Set/Map for O(1) lookups
- `js-tosorted-immutable` - Use toSorted() for immutability

## 8. Advanced patterns

- `advanced-event-handler-refs` - Store event handlers in refs
- `advanced-use-latest` - useLatest for stable callback refs
