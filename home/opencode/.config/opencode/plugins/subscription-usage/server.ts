// `/quota` server side (OpenCode V2 Effect API): resolves the session's provider credential in the
// server and answers the TUI with sanitized allowance text over RPC.
import type { Plugin } from "@opencode/plugin/effect/plugin"
import type { RpcHandlers, RpcRegistration } from "@opencode/plugin/effect/rpc"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { Effect, type Scope } from "effect"
import { definition } from "./rpc.ts"
import { makeUsage, type Connection, type Fetcher, type Lookups } from "./usage.ts"

/** The slice of OpenCode's plugin `Context` used here; the real `Context` satisfies it (see default export). */
export interface Host<C extends Connection> {
  readonly location: Lookups["location"]
  readonly session: { readonly get: (input: { readonly sessionID: Session.ID }) => ReturnType<Lookups["session"]> }
  readonly provider: {
    readonly get: (input: { readonly providerID: Provider.ID }) => Effect.Effect<{ readonly data: Effect.Success<ReturnType<Lookups["provider"]>> }, unknown>
  }
  readonly model: { readonly list: () => Effect.Effect<{ readonly data: Effect.Success<ReturnType<Lookups["models"]>> }, unknown> }
  readonly integration: {
    readonly connection: {
      readonly active: (integrationID: string) => Effect.Effect<C | undefined, unknown>
      readonly resolve: Lookups<C>["credential"]
    }
  }
  readonly rpc: {
    readonly register: (
      rpc: typeof definition,
      handlers: RpcHandlers<typeof definition>,
    ) => Effect.Effect<RpcRegistration<typeof definition>, unknown, Scope.Scope>
  }
}

export const setup = <C extends Connection>(host: Host<C>, options: { readonly fetcher?: Fetcher; readonly timeoutMs?: number } = {}) =>
  Effect.gen(function* () {
    const usage = yield* makeUsage<C>(
      {
        location: host.location,
        session: (sessionID) => host.session.get({ sessionID: Session.ID.make(sessionID) }),
        provider: (providerID) => host.provider.get({ providerID: Provider.ID.make(providerID) }).pipe(Effect.map(({ data }) => data)),
        models: () => host.model.list().pipe(Effect.map(({ data }) => data)),
        connection: (integrationID) => host.integration.connection.active(integrationID),
        credential: (connection) => host.integration.connection.resolve(connection),
      },
      options,
    )
    // The host interrupts the handler when the TUI aborts; that interrupts the fetch too.
    yield* host.rpc.register(definition, { get: ({ sessionID }) => usage.get(sessionID) }).pipe(Effect.orDie)
    return usage
  })

export default {
  id: "dotfiles-subscription-usage",
  effect: (ctx) => setup(ctx).pipe(Effect.asVoid),
} satisfies Plugin
