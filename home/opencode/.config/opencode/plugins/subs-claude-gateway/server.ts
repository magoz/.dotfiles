// `subs-claude` gateway plugin (OpenCode V2 Effect API).
//
// Hooks are registered in the plugin scope, so unloading removes them. A shaping failure is a
// defect: the host fails the request, and the sentinel URL (opencode.jsonc) stays in place as the
// second, URL-level fail-closed layer. That matches the previous Promise plugin, whose thrown
// errors the host's Promise adapter also turned into defects.
import type { Plugin } from "@opencode/plugin/effect/plugin"
import { Effect, type Scope } from "effect"
import {
  ANTHROPIC_GATEWAY_PROVIDERS,
  dropUnreplayableReasoning,
  shapeGatewayHttpRequest,
  type HttpRequestEvent,
  type SemanticEvent,
} from "./shaping.ts"

export const GATEWAY_ORIGIN_ENV = "OPENCODE_SUBS_CLAUDE_GATEWAY_ORIGIN"
/** Requests whose messages OpenCode lowers before dispatch: unreplayable reasoning is dropped there. */
export const SEMANTIC_HOOKS = ["context", "compaction", "generate", "title"] as const
export type SemanticHook = (typeof SEMANTIC_HOOKS)[number]

/** Provider-scoped hook registration; the default export adapts OpenCode's `ctx.session.hook`. */
export interface Hooks {
  readonly http: (providerID: string, callback: (event: HttpRequestEvent) => Effect.Effect<void>) => Effect.Effect<unknown, never, Scope.Scope>
  readonly semantic: (
    name: SemanticHook,
    providerID: string,
    callback: (event: SemanticEvent) => Effect.Effect<void>,
  ) => Effect.Effect<unknown, never, Scope.Scope>
}

/**
 * Registers, per gateway provider: `http.request` (every kind) for content shaping,
 * harness-header removal and sentinel -> gateway re-targeting; and the semantic hooks, which drop
 * reasoning OpenCode would otherwise lower to plain assistant text.
 */
export const setup = (hooks: Hooks, options: { readonly gatewayOrigin?: string | undefined } = {}) =>
  Effect.forEach(
    ANTHROPIC_GATEWAY_PROVIDERS,
    (providerID) =>
      Effect.gen(function* () {
        yield* hooks.http(providerID, (event) => shapeGatewayHttpRequest(event, options).pipe(Effect.orDie))
        for (const name of SEMANTIC_HOOKS) {
          yield* hooks.semantic(name, providerID, (event) => Effect.sync(() => dropUnreplayableReasoning(event)))
        }
      }),
    { discard: true },
  )

export default {
  id: "magoz.subs-claude-gateway",
  effect: (ctx) =>
    // Fail loudly at load: without hooks every subs-claude request would stay on the sentinel.
    typeof ctx.session?.hook !== "function"
      ? Effect.die(new Error("OpenCode session hooks unavailable; subs-claude requests would stay on the sentinel"))
      : setup(
          {
            http: (providerID, callback) => ctx.session.hook("http.request", callback, { providerID }),
            semantic: (name, providerID, callback) => ctx.session.hook(name, callback, { providerID }),
          },
          { gatewayOrigin: process.env[GATEWAY_ORIGIN_ENV] || undefined },
        ),
} satisfies Plugin
