import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform"
import { Effect, Option, Redacted, Schema } from "effect"
import {
  Branch,
  BranchListResponse,
  BranchResponse,
  ConnectionUriResponse,
  CreateBranchResponse,
  DatabaseListResponse,
  NeonError,
  ProjectResponse,
  READY_TIMEOUT_SECONDS,
  SUSPEND_TIMEOUT_SECONDS
} from "./domain"

const API_ROOT = "https://console.neon.tech/api/v2"

/**
 * Minimal access needed to talk to one project, so `auth login` can validate a
 * candidate credential before any of it is persisted.
 */
export interface NeonAccess {
  readonly apiKey: Redacted.Redacted<string>
  readonly projectId: string
}

const SECRET = /postgres(?:ql)?:\/\/[^\s"']+/gi
const redactText = (text: string) => text.replace(SECRET, "<redacted>")

const request = (
  config: NeonAccess,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const url = `${API_ROOT}/projects/${config.projectId}${path}`

    let req = HttpClientRequest.make(method)(url).pipe(
      HttpClientRequest.setHeaders({
        Authorization: `Bearer ${Redacted.value(config.apiKey)}`,
        Accept: "application/json"
      })
    )
    if (body !== undefined) {
      req = yield* HttpClientRequest.bodyJson(req, body).pipe(
        Effect.mapError((cause) => new NeonError({ message: `invalid request body: ${cause}` }))
      )
    }

    return yield* client.execute(req).pipe(
      Effect.mapError(() => new NeonError({ message: "neon unreachable" }))
    )
  })

const decode = <A, I>(
  schema: Schema.Schema<A, I>,
  response: HttpClientResponse.HttpClientResponse
) =>
  HttpClientResponse.schemaBodyJson(schema)(response).pipe(
    Effect.mapError(
      (cause) =>
        new NeonError({ message: `unexpected neon response shape: ${redactText(String(cause))}` })
    )
  )

const failing = (response: HttpClientResponse.HttpClientResponse, action: string) =>
  response.text.pipe(
    Effect.orElseSucceed(() => ""),
    Effect.flatMap((text) =>
      Effect.fail(
        new NeonError({
          message: `${action} failed (${response.status}): ${redactText(text).slice(0, 400)}`
        })
      )
    )
  )

/** Branch lookup that treats "gone" as a value rather than an error. */
export const getBranch = (config: NeonAccess, branchId: string) =>
  Effect.gen(function* () {
    const response = yield* request(config, "GET", `/branches/${branchId}`)
    if (response.status === 404) return Option.none<Branch>()
    if (response.status >= 400) return yield* failing(response, "branch lookup")
    const body = yield* decode(BranchResponse, response)
    return Option.some(body.branch)
  })

export const listBranches = (config: NeonAccess) =>
  Effect.gen(function* () {
    const response = yield* request(config, "GET", "/branches")
    if (response.status >= 400) return yield* failing(response, "branch listing")
    const body = yield* decode(BranchListResponse, response)
    return body.branches
  })

export const listDatabases = (config: NeonAccess, branchId: string) =>
  Effect.gen(function* () {
    const response = yield* request(config, "GET", `/branches/${branchId}/databases`)
    if (response.status >= 400) return yield* failing(response, "database listing")
    const body = yield* decode(DatabaseListResponse, response)
    return body.databases
  })

export interface ConnectionTarget {
  readonly databaseName: string
  readonly roleName: string
}

const retrieveConnectionUri = (
  config: NeonAccess,
  branchId: string,
  target: ConnectionTarget,
  pooled: boolean
) =>
  Effect.gen(function* () {
    const query = new URLSearchParams({
      branch_id: branchId,
      database_name: target.databaseName,
      role_name: target.roleName,
      pooled: String(pooled)
    })
    const response = yield* request(config, "GET", `/connection_uri?${query}`)
    if (response.status >= 400) return yield* failing(response, "connection URI retrieval")
    return (yield* decode(ConnectionUriResponse, response)).uri
  })

export const getConnectionUris = (
  config: NeonAccess,
  branchId: string,
  recordedTarget?: ConnectionTarget
) =>
  Effect.gen(function* () {
    const target = recordedTarget ?? (yield* listDatabases(config, branchId).pipe(
      Effect.flatMap((databases) =>
        databases.length === 1
          ? Effect.succeed({
              databaseName: databases[0]!.name,
              roleName: databases[0]!.owner_name
            })
          : Effect.fail(
              new NeonError({
                message:
                  `cannot restore connection URLs for branch ${branchId}: ` +
                  `expected one database, found ${databases.length}`
              })
            )
      )
    ))
    const [direct, pooled] = yield* Effect.all([
      retrieveConnectionUri(config, branchId, target, false),
      retrieveConnectionUri(config, branchId, target, true)
    ], { concurrency: 2 })
    return { ...target, direct, pooled }
  })

/** Validates a credential against one project and returns its display name. */
export const describeProject = (config: NeonAccess) =>
  Effect.gen(function* () {
    const response = yield* request(config, "GET", "")
    if (response.status === 401 || response.status === 403) {
      return yield* Effect.fail(new NeonError({ message: "credential rejected by neon" }))
    }
    if (response.status === 404) {
      return yield* Effect.fail(
        new NeonError({
          message: `project ${config.projectId} not found, or this key is scoped to another project`
        })
      )
    }
    if (response.status >= 400) return yield* failing(response, "project lookup")
    const body = yield* decode(ProjectResponse, response)
    return body.project
  })

/** Resolve the default parent when global auth does not name one explicitly. */
export const findDefaultBranch = (config: NeonAccess) =>
  listBranches(config).pipe(
    Effect.flatMap((branches) => {
      const found = branches.find((branch) => branch.default === true)
      return found
        ? Effect.succeed(found)
        : Effect.fail(new NeonError({ message: "project has no default branch" }))
    })
  )

export interface CreatedBranch {
  readonly branch: Branch
  readonly pooled: Redacted.Redacted<string>
  readonly direct: Redacted.Redacted<string>
  readonly databaseName: string
  readonly roleName: string
}

export const createBranch = (
  config: NeonAccess & { readonly parentBranch: string },
  options: { readonly name: string; readonly expiresAt: string }
) =>
  Effect.gen(function* () {
    const response = yield* request(config, "POST", "/branches", {
      branch: {
        name: options.name,
        parent_id: config.parentBranch,
        expires_at: options.expiresAt
      },
      endpoints: [{ type: "read_write", suspend_timeout_seconds: SUSPEND_TIMEOUT_SECONDS }]
    })
    if (response.status >= 400) return yield* failing(response, "branch creation")

    const body = yield* decode(CreateBranchResponse, response)
    const first = (body.connection_uris ?? [])[0]
    if (!first) {
      return yield* Effect.fail(
        new NeonError({ message: "neon returned no connection uri for the new branch" })
      )
    }

    const host = first.connection_parameters?.host
    const poolerHost = first.connection_parameters?.pooler_host
    const databaseName = first.connection_parameters?.database
    const roleName = first.connection_parameters?.role
    if (!databaseName || !roleName) {
      return yield* Effect.fail(
        new NeonError({ message: "neon returned no database or role for the new branch" })
      )
    }
    const direct = first.connection_uri
    const pooled =
      host && poolerHost
        ? Redacted.make(Redacted.value(direct).replace(host, poolerHost))
        : direct

    return {
      branch: body.branch,
      pooled,
      direct,
      databaseName,
      roleName
    } satisfies CreatedBranch
  })

export const setExpiration = (config: NeonAccess, branchId: string, expiresAt: string) =>
  Effect.gen(function* () {
    const response = yield* request(config, "PATCH", `/branches/${branchId}`, {
      branch: { expires_at: expiresAt }
    })
    if (response.status >= 400) return yield* failing(response, "expiration update")
    const body = yield* decode(BranchResponse, response)
    return body.branch
  })

export const deleteBranch = (config: NeonAccess, branchId: string) =>
  Effect.gen(function* () {
    const response = yield* request(config, "DELETE", `/branches/${branchId}`)
    if (response.status === 404) return
    if (response.status >= 400) return yield* failing(response, "branch deletion")
  })

/** Poll until the compute is usable; a timeout is reported, never thrown away. */
export const waitUntilReady = (config: NeonAccess, branchId: string) => {
  const currentState = getBranch(config, branchId).pipe(
    Effect.map(
      Option.match({
        onNone: () => "missing",
        onSome: (branch) => branch.current_state ?? "unknown"
      })
    )
  )

  const settled = (state: string) => state === "ready" || state === "missing"

  return Effect.gen(function* () {
    let state = yield* currentState
    while (!settled(state)) {
      yield* Effect.sleep("2 seconds")
      state = yield* currentState
    }
    return state
  }).pipe(
    Effect.timeout(`${READY_TIMEOUT_SECONDS} seconds`),
    Effect.orElseSucceed(() => "not-ready")
  )
}
