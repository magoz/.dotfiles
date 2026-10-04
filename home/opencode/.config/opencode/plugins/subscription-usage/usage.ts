// Subscription allowance for the session's provider. Provider payload conventions mirror the Pi
// footer; no Pi imports, auth files, account switching or inference calls. Only sanitized quota
// text leaves here: never tokens, raw bodies or provider errors.
import { Clock, Data, Effect, Exit, Fiber, FiberMap, Option } from "effect"

export type ProviderID = "openai" | "anthropic" | "xai" | "zai"

interface ProviderConfig {
  readonly url: string
  readonly origins: readonly string[]
  readonly ttl: number
  /** `key`: the endpoint takes an API key; otherwise official OAuth only. */
  readonly authKind: "oauth" | "key"
}

const providers: Readonly<Record<ProviderID, ProviderConfig>> = {
  openai: { url: "https://chatgpt.com/backend-api/wham/usage", origins: ["https://api.openai.com", "https://chatgpt.com"], ttl: 300_000, authKind: "oauth" },
  anthropic: { url: "https://api.anthropic.com/api/oauth/usage", origins: ["https://api.anthropic.com"], ttl: 600_000, authKind: "oauth" },
  xai: { url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits", origins: ["https://api.x.ai", "https://cli-chat-proxy.grok.com"], ttl: 300_000, authKind: "oauth" },
  zai: { url: "https://api.z.ai/api/monitor/usage/quota/limit", origins: ["https://api.z.ai"], ttl: 300_000, authKind: "key" },
}
const isProvider = (id: string | undefined): id is ProviderID => id !== undefined && Object.hasOwn(providers, id)

/** Hard retention from the last successful sample; failures never extend it. */
export const STALE_RETENTION_MS = 86_400_000
export const MAX_RESPONSE_BYTES = 65_536
export const DEFAULT_TIMEOUT_MS = 15_000
const MAX_BACKOFF_MS = 86_400_000
const MAX_CACHE = 128

export type Status = "available" | "stale" | "unavailable"
export interface Result {
  readonly status: Status
  readonly text: string
}
export const UNAVAILABLE: Result = { status: "unavailable", text: "Subscription quota unavailable (requires a supported official connection)." }

// ---- payload normalization (tolerant: unknown shapes yield no windows) ------------------

export interface Window {
  readonly label: string
  readonly left: number
  readonly reset: number | undefined
}

type Json = Readonly<Record<string, unknown>>
const record = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
const left = (used: number) => Math.max(0, Math.min(100, 100 - used))
const date = (value: unknown) => (typeof value === "string" ? finite(Date.parse(value)) : undefined)
const field = (value: unknown, key: string) => (record(value) ? value[key] : undefined)

export function windows(provider: ProviderID, payload: unknown, now: number): readonly Window[] {
  if (!record(payload)) return []
  if (provider === "anthropic") {
    return ([["five_hour", "5h"], ["seven_day", "7d"]] as const).flatMap(([key, label]) => {
      const used = finite(field(payload[key], "utilization"))
      return used === undefined ? [] : [{ label, left: left(used), reset: date(field(payload[key], "resets_at")) }]
    })
  }
  if (provider === "openai") {
    const limits = payload["rate_limit"]
    if (!record(limits)) return []
    return ([["primary_window", "5h"], ["secondary_window", "7d"]] as const).flatMap(([key, label]) => {
      const used = finite(field(limits[key], "used_percent"))
      if (used === undefined) return []
      const absolute = finite(field(limits[key], "reset_at"))
      const relative = finite(field(limits[key], "reset_after_seconds"))
      const reset = absolute !== undefined ? absolute * 1000 : relative !== undefined ? now + Math.max(0, relative) * 1000 : undefined
      return [{ label, left: left(used), reset }]
    })
  }
  if (provider === "xai") {
    const config = payload["config"]
    const used = finite(field(config, "creditUsagePercent"))
    if (used === undefined) return []
    const period = field(config, "currentPeriod")
    const type = field(period, "type")
    const label = type === "USAGE_PERIOD_TYPE_WEEKLY" ? "7d" : type === "USAGE_PERIOD_TYPE_MONTHLY" ? "month" : "usage"
    return [{ label, left: left(used), reset: date(field(period, "end")) }]
  }
  // zai: live Max-plan keys report CREDIT_LIMIT; older/token plans reported TOKENS_LIMIT.
  const limits = field(payload["data"], "limits")
  if (!Array.isArray(limits)) return []
  const kinds = new Set(["TOKENS_LIMIT", "CREDIT_LIMIT"])
  return ([[3, "5h"], [6, "7d"]] as const).flatMap(([unit, label]) => {
    const limit: unknown = limits.find((value) => record(value) && kinds.has(String(value["type"])) && value["unit"] === unit)
    const used = finite(field(limit, "percentage"))
    return used === undefined ? [] : [{ label, left: left(used), reset: finite(field(limit, "nextResetTime")) }]
  })
}

export function format(items: readonly Window[], now: number): string {
  return items
    .map((w) => {
      const minutes = w.reset === undefined ? undefined : Math.ceil((w.reset - now) / 60_000)
      const reset = minutes === undefined ? "reset unknown" : minutes <= 0 ? "reset pending" : `resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
      return `${w.label}: ${Math.round(w.left)}% left · ${reset}`
    })
    .join("\n")
}

/** Endpoint overrides live in `settings.baseURL` (V2.0.20 provider/model schema). */
export interface Endpoint {
  readonly settings?: Readonly<Record<string, unknown>> | undefined
}

/** Only supported official origins, or the explicit local Claude Pro/Max adapter. */
export function allowedOrigin(provider: string, definition: Endpoint | undefined, credential: { readonly methodID?: string | undefined }): boolean {
  if (!isProvider(provider)) return false
  const url = definition?.settings?.["baseURL"]
  if (url === undefined) return true
  if (typeof url !== "string") return false
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) return false
    return (
      providers[provider].origins.includes(parsed.origin) ||
      (provider === "anthropic" && credential.methodID === "claude-pro-max" && parsed.protocol === "http:" && parsed.hostname === "127.0.0.1")
    )
  } catch {
    return false
  }
}

// ---- bounded fetch ------------------------------------------------------------------------

class ProviderFailure extends Data.TaggedError("ProviderFailure")<{ readonly backoffUntil?: number }> {}

/** Reads at most MAX_RESPONSE_BYTES while streaming; the reader is cancelled on any early exit. */
export const readBounded = (response: Response) =>
  Effect.acquireUseRelease(
    Effect.suspend(() => (response.body ? Effect.succeed(response.body.getReader()) : Effect.fail(new ProviderFailure({})))),
    (reader) =>
      Effect.gen(function* () {
        const chunks: Uint8Array[] = []
        let size = 0
        for (;;) {
          const { done, value } = yield* Effect.tryPromise({ try: () => reader.read(), catch: () => new ProviderFailure({}) })
          if (done) break
          size += value.byteLength
          if (size > MAX_RESPONSE_BYTES) return yield* new ProviderFailure({})
          chunks.push(value)
        }
        return yield* Effect.try({
          try: () => new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)),
          catch: () => new ProviderFailure({}),
        })
      }),
    (reader, exit) =>
      Effect.sync(() => {
        if (Exit.isFailure(exit)) void reader.cancel().catch(() => {})
        reader.releaseLock()
      }),
  )

const cancelBody = (response: Response) => {
  if (response.body) void response.body.cancel().catch(() => {})
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

// ---- the session usage service ----------------------------------------------------------

interface SessionLike {
  readonly id: string
  readonly location: { readonly directory: string; readonly workspaceID?: string | undefined }
  readonly model?: { readonly id: string; readonly providerID: string } | undefined
}
interface ProviderLike extends Endpoint {
  readonly id: string
  readonly integrationID?: string | undefined
}
interface ModelLike extends Endpoint {
  readonly id: string
  readonly providerID: string
}
export type Credential =
  | { readonly type: "oauth"; readonly access: string; readonly methodID?: string | undefined; readonly metadata?: Readonly<Record<string, unknown>> | undefined }
  | { readonly type: "key"; readonly key: string; readonly metadata?: Readonly<Record<string, unknown>> | undefined }
export interface Connection {
  readonly type: string
  readonly id?: string | undefined
}

/** What the usage service reads from OpenCode. Every lookup may fail; a failure means unavailable. */
export interface Lookups<C extends Connection = Connection> {
  readonly location: { readonly directory: string; readonly workspaceID?: string | undefined }
  readonly session: (sessionID: string) => Effect.Effect<SessionLike, unknown>
  readonly provider: (providerID: string) => Effect.Effect<ProviderLike, unknown>
  readonly models: () => Effect.Effect<ReadonlyArray<ModelLike>, unknown>
  readonly connection: (integrationID: string) => Effect.Effect<C | undefined, unknown>
  readonly credential: (connection: C) => Effect.Effect<Credential | undefined, unknown>
}

interface Snapshot {
  readonly at: number
  readonly value: Result
}
interface Entry {
  until: number
  fresh: boolean
  snapshot: Snapshot | undefined
}

class Unavailable extends Data.TaggedError("Unavailable")<{}> {}

export const makeUsage = <C extends Connection>(host: Lookups<C>, options: { readonly fetcher?: Fetcher; readonly timeoutMs?: number } = {}) =>
  Effect.gen(function* () {
    const fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const cache = new Map<string, Entry>()
    // A newer request for a session interrupts that session's older one, including auth
    // resolution. Different sessions overlap; only the current cache entry can publish.
    const requests = yield* FiberMap.make<string, Result>()

    const fallback = (entry: Entry | undefined, now: number): Result =>
      entry?.snapshot && now - entry.snapshot.at < STALE_RETENTION_MS
        ? { status: "stale", text: `${entry.snapshot.value.text}\n(stale)` }
        : UNAVAILABLE

    const need = <A>(value: A | undefined | false): Effect.Effect<A, Unavailable> =>
      value === undefined || value === false ? Effect.fail(new Unavailable()) : Effect.succeed(value)
    const lookup = <A>(effect: Effect.Effect<A, unknown>) => effect.pipe(Effect.mapError(() => new Unavailable()))

    const fetchQuota = (providerID: ProviderID, headers: Record<string, string>) =>
      Effect.gen(function* () {
        const config = providers[providerID]
        const response = yield* Effect.suspend(() => {
          const controller = new AbortController()
          const pending = fetcher(config.url, { headers, redirect: "error", signal: controller.signal })
          return Effect.tryPromise({ try: () => pending, catch: () => new ProviderFailure({}) }).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                controller.abort()
                // A transport that ignores cancellation may still answer late: close that body too.
                void pending.then(cancelBody, () => {})
              }),
            ),
          )
        })
        if (!response.ok) {
          cancelBody(response)
          const now = yield* Clock.currentTimeMillis
          if (response.status === 429) {
            const raw = response.headers.get("retry-after")
            const seconds = Number(raw)
            const retry = raw && Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : date(raw)
            if (retry) return yield* new ProviderFailure({ backoffUntil: Math.min(retry, now + MAX_BACKOFF_MS) })
          }
          return yield* new ProviderFailure({})
        }
        const text = yield* readBounded(response)
        const payload = yield* Effect.try({ try: (): unknown => JSON.parse(text), catch: () => new ProviderFailure({}) })
        const items = windows(providerID, payload, yield* Clock.currentTimeMillis)
        if (!items.length) return yield* new ProviderFailure({})
        return items
      }).pipe(
        Effect.timeoutOption(timeoutMs),
        Effect.flatMap(Option.match({ onNone: () => Effect.fail(new ProviderFailure({})), onSome: Effect.succeed })),
      )

    const work = (sessionID: string) =>
      Effect.gen(function* () {
        const session = yield* lookup(host.session(sessionID))
        if (
          session.id !== sessionID ||
          session.location.directory !== host.location.directory ||
          (session.location.workspaceID ?? undefined) !== (host.location.workspaceID ?? undefined)
        ) {
          return yield* new Unavailable()
        }
        const providerID = yield* need(isProvider(session.model?.providerID) ? session.model?.providerID : undefined)
        const modelID = yield* need(session.model?.id)
        const config = providers[providerID]
        const provider = yield* lookup(host.provider(providerID))
        yield* need(provider.id === providerID && provider.integrationID === providerID)
        const connection = yield* need(yield* lookup(host.connection(providerID)))
        if (connection.type !== "credential" || typeof connection.id !== "string" || !connection.id) return yield* new Unavailable()
        const credential = yield* need(yield* lookup(host.credential(connection)))
        // OAuth providers keep API keys out; the Z.ai monitor endpoint is API-key only.
        const token =
          config.authKind === "key"
            ? credential.type === "key" ? credential.key : undefined
            : credential.type === "oauth" ? credential.access : undefined
        if (!token) return yield* new Unavailable()
        const methodID = credential.type === "oauth" ? credential.methodID : undefined
        yield* need(allowedOrigin(providerID, provider, { methodID }))
        const model = (yield* lookup(host.models())).find((m) => m.providerID === providerID && m.id === modelID)
        yield* need(model !== undefined && allowedOrigin(providerID, model, { methodID }))
        const account = credential.metadata?.["accountID"]
        const accountID = typeof account === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(account) ? account : undefined
        if (account !== undefined && !accountID) return yield* new Unavailable()

        const key = JSON.stringify([providerID, connection.id, accountID])
        const previous = cache.get(key)
        const now = yield* Clock.currentTimeMillis
        if (previous && now < previous.until) return previous.fresh && previous.snapshot ? previous.snapshot.value : fallback(previous, now)
        const entry: Entry = { until: 0, fresh: false, snapshot: previous?.snapshot && now - previous.snapshot.at < STALE_RETENTION_MS ? previous.snapshot : undefined }
        cache.set(key, entry)
        if (cache.size > MAX_CACHE) {
          const oldest = cache.keys().next()
          if (!oldest.done) cache.delete(oldest.value)
        }
        const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" }
        if (providerID === "openai" && accountID) headers["ChatGPT-Account-Id"] = accountID
        if (providerID === "anthropic") headers["anthropic-beta"] = "oauth-2025-04-20"
        if (providerID === "xai") headers["X-XAI-Token-Auth"] = "xai-grok-cli"
        // Interruption (caller abort, a newer request, unload) skips all of this: it neither
        // publishes a result nor installs a failure backoff.
        return yield* fetchQuota(providerID, headers).pipe(
          Effect.matchEffect({
            onSuccess: (items) =>
              Clock.currentTimeMillis.pipe(
                Effect.map((at): Result => {
                  if (cache.get(key) !== entry) return UNAVAILABLE
                  const value: Result = { status: "available", text: format(items, at) }
                  entry.snapshot = { at, value }
                  entry.fresh = true
                  entry.until = at + config.ttl
                  return value
                }),
              ),
            // Provider failures (network, timeout, HTTP, body, parse, unknown payload) share one fallback.
            // The retry waits one TTL from when this request started (429 may extend it).
            onFailure: (failure) =>
              Clock.currentTimeMillis.pipe(
                Effect.map((at): Result => {
                  if (cache.get(key) !== entry) return UNAVAILABLE
                  entry.until = Math.max(now + config.ttl, failure.backoffUntil ?? 0)
                  return fallback(entry, at)
                }),
              ),
          }),
        )
      }).pipe(Effect.catchTag("Unavailable", () => Effect.succeed(UNAVAILABLE)))

    /** Never fails: superseded, cancelled or unloaded requests answer unavailable, never stale. */
    const get = (sessionID: string): Effect.Effect<Result> =>
      Effect.gen(function* () {
        const fiber = yield* FiberMap.run(requests, sessionID, work(sessionID))
        const exit = yield* Fiber.await(fiber).pipe(Effect.onInterrupt(() => Fiber.interrupt(fiber)))
        return Exit.isSuccess(exit) ? exit.value : UNAVAILABLE
      })

    return { get }
  })
