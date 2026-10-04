// Server side of the pane bridge. The server never allocates: it queues one request for exactly
// one live TUI bound to the root session, which claims it, asks the user, runs the CLI in its own
// pane and completes it. Interrupting the waiting tool call withdraws its request.
import { randomUUID } from "node:crypto"
import { Clock, Data, Deferred, Duration, Effect, Schedule } from "effect"
import type { Outcome, PaneRequest, ResolvedInput } from "./contract.ts"

export class BridgeError extends Data.TaggedError("BridgeError")<{ readonly message: string }> {}

const LEASE_MS = 6000

interface Client {
  readonly clientID: string
  readonly rootID: string
  readonly seen: number
}

interface Pending {
  readonly id: string
  readonly sessionID: string
  readonly rootID: string
  readonly cwd: string
  readonly input: ResolvedInput
  readonly clientID: string
  readonly created: number
  readonly deadline: number
  claimed: boolean
  readonly done: Deferred.Deferred<Outcome, BridgeError>
}

export interface Identity {
  readonly clientID: string
  readonly rootID: string
}

export const makeBridge = (options: { readonly leaseMs?: number } = {}) =>
  Effect.gen(function* () {
    const leaseMs = options.leaseMs ?? LEASE_MS
    const clients = new Map<string, Client>()
    const requests = new Map<string, Pending>()
    let closed = false

    const live = (rootID: string, now: number) => [...clients.values()].filter((client) => client.rootID === rootID && now - client.seen < leaseMs)

    const fail = (request: Pending, message: string) =>
      Effect.suspend(() => {
        requests.delete(request.id)
        return Deferred.fail(request.done, new BridgeError({ message }))
      }).pipe(Effect.asVoid)

    /** Expires leases; a request whose client vanished, became ambiguous or ran out of time fails closed. */
    const sweep = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      for (const [id, client] of clients) if (now - client.seen >= leaseMs) clients.delete(id)
      for (const request of [...requests.values()]) {
        const bound = live(request.rootID, now)
        if (bound.length !== 1 || bound[0]?.clientID !== request.clientID || now >= request.deadline) {
          yield* fail(request, "Client absent, ambiguous, or request expired; inspect partial resources before retrying")
        }
      }
    })

    /** Queues one request and waits for its pane outcome. Interruption withdraws it. */
    const request = (spec: { readonly sessionID: string; readonly rootID: string; readonly cwd: string; readonly input: ResolvedInput }, timeout: Duration.Input) =>
      Effect.gen(function* () {
        if (closed) return yield* new BridgeError({ message: "Bridge unavailable" })
        yield* sweep
        const now = yield* Clock.currentTimeMillis
        const bound = live(spec.rootID, now)
        const client = bound[0]
        if (bound.length !== 1 || !client) return yield* new BridgeError({ message: "Exactly one live TUI on the root session is required" })
        if ([...requests.values()].some((pending) => pending.rootID === spec.rootID)) return yield* new BridgeError({ message: "Another pane operation is pending" })
        const pending: Pending = {
          ...spec,
          id: randomUUID(),
          clientID: client.clientID,
          created: now,
          deadline: now + Duration.toMillis(Duration.fromInputUnsafe(timeout)),
          claimed: false,
          done: yield* Deferred.make<Outcome, BridgeError>(),
        }
        requests.set(pending.id, pending)
        return yield* Deferred.await(pending.done).pipe(
          Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.fail(new BridgeError({ message: "Request expired; inspect partial resources before retrying" })) }),
          Effect.ensuring(Effect.sync(() => { requests.delete(pending.id) })),
        )
      })

    const release = (input: Identity) =>
      Effect.gen(function* () {
        const client = clients.get(input.clientID)
        if (!client || client.rootID !== input.rootID) return { released: false }
        clients.delete(input.clientID)
        for (const pending of [...requests.values()]) {
          if (pending.clientID === input.clientID) yield* fail(pending, "TUI disposed or route changed; inspect partial resources")
        }
        return { released: true }
      })

    /** Heartbeat from a TUI bound to `rootID`; atomically claims its next unclaimed request. */
    const pulse = (input: Identity) =>
      Effect.gen(function* () {
        if (closed) return yield* new BridgeError({ message: "Bridge unavailable" })
        yield* sweep
        const old = clients.get(input.clientID)
        if (old && old.rootID !== input.rootID) yield* release(old)
        clients.set(input.clientID, { ...input, seen: yield* Clock.currentTimeMillis })
        yield* sweep
        const mine = [...requests.values()].filter((pending) => pending.clientID === input.clientID && pending.rootID === input.rootID)
        const next = mine.find((pending) => !pending.claimed)
        if (next) next.claimed = true // claimed before returning, never reissued
        const claim: PaneRequest | null = next
          ? { id: next.id, sessionID: next.sessionID, rootID: next.rootID, cwd: next.cwd, kind: "worktree", input: next.input }
          : null
        return { request: claim, active: mine.map((pending) => pending.id) }
      })

    const authorize = (input: Identity & { readonly id: string }) =>
      sweep.pipe(
        Effect.map(() => {
          const pending = requests.get(input.id)
          return { authorized: !closed && !!pending && pending.claimed && pending.clientID === input.clientID && pending.rootID === input.rootID }
        }),
      )

    /** The claiming TUI's outcome. A ready destination must be on the requested branch. */
    const complete = (input: Identity & { readonly id: string; readonly outcome: Outcome }) =>
      Effect.gen(function* () {
        yield* sweep
        const pending = requests.get(input.id)
        if (!pending || !pending.claimed || pending.clientID !== input.clientID || pending.rootID !== input.rootID) return { acknowledged: false }
        if (input.outcome.status === "ready" && input.outcome.destination.branch !== pending.input.branch) {
          return yield* new BridgeError({ message: "Destination branch mismatch" })
        }
        requests.delete(pending.id)
        yield* Deferred.succeed(pending.done, input.outcome)
        return { acknowledged: true }
      })

    /** Interruption/deletion events cancel only requests created at or before the event: an old event cannot poison a later run. */
    const cancelSession = (sessionID: string, created = Number.POSITIVE_INFINITY) =>
      Effect.forEach(
        [...requests.values()].filter((pending) => pending.sessionID === sessionID && pending.created <= created),
        (pending) => fail(pending, "Session interrupted or deleted; inspect partial resources before retrying"),
        { discard: true },
      )

    yield* sweep.pipe(Effect.repeat(Schedule.spaced("1 second")), Effect.forkScoped)
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closed = true
        for (const pending of [...requests.values()]) yield* fail(pending, "Plugin unloaded; inspect partial resources")
        clients.clear()
      }),
    )

    return { request, pulse, authorize, complete, release, cancelSession, sweep, pending: () => requests.size }
  })

export type Bridge = Effect.Success<ReturnType<typeof makeBridge>>
