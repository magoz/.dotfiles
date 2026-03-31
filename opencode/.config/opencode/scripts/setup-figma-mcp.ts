#!/usr/bin/env bun
/**
 * Setup official Figma MCP server for OpenCode.
 * Registers OAuth client with Figma, patches global opencode config,
 * cleans stale auth, and prompts for browser OAuth flow.
 *
 * Usage: bun ~/.config/opencode/scripts/setup-figma-mcp.ts
 * Idempotent -- safe to re-run.
 */

import { Effect, pipe } from "effect"
import {
  FetchHttpClient,
  FileSystem,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import { BunFileSystem } from "@effect/platform-bun"
import { homedir } from "os"
import { join } from "path"

// ── config ──────────────────────────────────────────────────────────

const HOME = homedir()
const OPENCODE_CONFIG = process.env.OPENCODE_CONFIG ?? join(HOME, ".config/opencode/opencode.jsonc")
const ENV_FILE = process.env.ENV_FILE ?? join(HOME, ".env")
const MCP_AUTH_FILE = join(HOME, ".local/share/opencode/mcp-auth.json")
const FIGMA_REGISTER_URL = "https://api.figma.com/v1/oauth/mcp/register"
const CALLBACK_URL = "http://127.0.0.1:19876/mcp/oauth/callback"

const FIGMA_CONFIG_BLOCK = [
  `    "figma": {`,
  `      "type": "remote",`,
  `      "url": "https://mcp.figma.com/mcp",`,
  `      "oauth": {`,
  `        "clientId": "{env:FIGMA_MCP_CLIENT_ID}",`,
  `        "clientSecret": "{env:FIGMA_MCP_CLIENT_SECRET}",`,
  `      },`,
  `      "enabled": true,`,
  `    },`,
].join("\n")

// ── helpers ─────────────────────────────────────────────────────────

const info = (msg: string) => Effect.sync(() => console.log(`:: ${msg}`))

class SetupError {
  readonly _tag = "SetupError"
  constructor(readonly message: string) {}
}

const fs = Effect.map(FileSystem.FileSystem, (fs) => fs)

const readTextFile = (path: string) =>
  pipe(
    fs,
    Effect.flatMap((f) => f.readFileString(path)),
    Effect.mapError(() => new SetupError(`failed to read ${path}`)),
  )

const writeTextFile = (path: string, content: string) =>
  pipe(
    fs,
    Effect.flatMap((f) => f.writeFileString(path, content)),
    Effect.mapError(() => new SetupError(`failed to write ${path}`)),
  )

const fileExists = (path: string) =>
  pipe(
    fs,
    Effect.flatMap((f) => f.exists(path)),
    Effect.mapError(() => new SetupError(`failed to check ${path}`)),
  )

// ── steps ───────────────────────────────────────────────────────────

/** Check if figma MCP is already in the opencode config */
const checkAlreadyConfigured = pipe(
  readTextFile(OPENCODE_CONFIG),
  Effect.flatMap((content) => {
    const hasFigma = content.includes('"figma"')
    const hasUrl = content.includes("mcp.figma.com")
    const hasClientId = content.includes('"clientId"')
    return hasFigma && hasUrl && hasClientId
      ? Effect.fail("already_configured" as const)
      : Effect.succeed(content)
  }),
)

/** Parse credentials from ~/.env lines like: export FIGMA_MCP_CLIENT_ID="xxx" */
const parseEnvVar = (content: string, key: string): string | undefined => {
  const match = content.match(new RegExp(`^export ${key}="([^"]*)"`, "m"))
  return match?.[1]
}

type Credentials = { readonly clientId: string; readonly clientSecret: string }

/** Try reading existing credentials from env file */
const readCredentialsFromEnv = pipe(
  fileExists(ENV_FILE),
  Effect.flatMap((envExists): Effect.Effect<Credentials | null, SetupError, FileSystem.FileSystem> =>
    envExists
      ? pipe(
          readTextFile(ENV_FILE),
          Effect.map((content) => {
            const clientId = parseEnvVar(content, "FIGMA_MCP_CLIENT_ID")
            const clientSecret = parseEnvVar(content, "FIGMA_MCP_CLIENT_SECRET")
            return clientId && clientSecret ? { clientId, clientSecret } : null
          }),
        )
      : Effect.succeed(null),
  ),
)

/** Register a new OAuth client with Figma */
const registerWithFigma = pipe(
  HttpClientRequest.post(FIGMA_REGISTER_URL),
  HttpClientRequest.bodyJson({
    client_name: "OpenCode (figma)",
    redirect_uris: [CALLBACK_URL],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }),
  Effect.flatMap(HttpClient.execute),
  Effect.flatMap(HttpClientResponse.filterStatusOk),
  Effect.flatMap((res) => res.json),
  Effect.flatMap((data: unknown) => {
    const d = data as { client_id?: string; client_secret?: string }
    return d.client_id && d.client_secret
      ? Effect.succeed({ clientId: d.client_id, clientSecret: d.client_secret })
      : Effect.fail(new SetupError("missing client_id or client_secret in response"))
  }),
  Effect.catchTag("HttpClientError", (err) =>
    Effect.fail(
      new SetupError(
        `Figma registration failed: ${err.message}. Set FIGMA_MCP_CLIENT_ID and FIGMA_MCP_CLIENT_SECRET in ${ENV_FILE} manually.`,
      ),
    ),
  ),
  Effect.catchTag("ResponseError", (err) =>
    Effect.fail(
      new SetupError(
        `Figma returned ${err.response.status}. Set FIGMA_MCP_CLIENT_ID and FIGMA_MCP_CLIENT_SECRET in ${ENV_FILE} manually.`,
      ),
    ),
  ),
)

/** Save credentials to ~/.env */
const saveCredentialsToEnv = (creds: Credentials) =>
  pipe(
    fileExists(ENV_FILE),
    Effect.flatMap((envExists) =>
      envExists ? readTextFile(ENV_FILE) : Effect.succeed(""),
    ),
    Effect.flatMap((content) => {
      const hasExisting = content.includes("FIGMA_MCP_CLIENT_ID")
      const updated = hasExisting
        ? content
            .replace(/^export FIGMA_MCP_CLIENT_ID=.*/m, `export FIGMA_MCP_CLIENT_ID="${creds.clientId}"`)
            .replace(/^export FIGMA_MCP_CLIENT_SECRET=.*/m, `export FIGMA_MCP_CLIENT_SECRET="${creds.clientSecret}"`)
        : `${content}\nexport FIGMA_MCP_CLIENT_ID="${creds.clientId}"\nexport FIGMA_MCP_CLIENT_SECRET="${creds.clientSecret}"\n`
      return writeTextFile(ENV_FILE, updated)
    }),
    Effect.tap(() => info(`saved credentials to ${ENV_FILE}`)),
  )

/** Resolve credentials: env file first, then register */
const resolveCredentials = pipe(
  readCredentialsFromEnv,
  Effect.flatMap((existing) =>
    existing
      ? pipe(
          info(`found existing credentials in ${ENV_FILE}`),
          Effect.map(() => existing),
        )
      : pipe(
          info("registering OAuth client with Figma..."),
          Effect.flatMap(() => registerWithFigma),
          Effect.tap((creds) => info(`registered client: ${creds.clientId}`)),
          Effect.tap(saveCredentialsToEnv),
        ),
  ),
)

/** Insert figma block into opencode config after "mcp": { */
const patchConfig = pipe(
  info(`patching ${OPENCODE_CONFIG}...`),
  Effect.flatMap(() => readTextFile(OPENCODE_CONFIG)),
  Effect.flatMap((content) => {
    const lines = content.split("\n")
    const mcpIdx = lines.findIndex((l) => /"mcp"\s*:\s*\{/.test(l))
    if (mcpIdx === -1) return Effect.fail(new SetupError("could not find 'mcp' block in config"))
    lines.splice(mcpIdx + 1, 0, FIGMA_CONFIG_BLOCK)
    return writeTextFile(OPENCODE_CONFIG, lines.join("\n"))
  }),
  Effect.tap(() => info("config updated")),
)

/** Remove stale figma entry from mcp-auth.json */
const cleanStaleAuth = pipe(
  fileExists(MCP_AUTH_FILE),
  Effect.flatMap((authExists) => {
    if (!authExists) return Effect.void
    return pipe(
      readTextFile(MCP_AUTH_FILE),
      Effect.flatMap((content) => {
        const data = JSON.parse(content) as Record<string, unknown>
        if (!("figma" in data)) return info("no stale figma auth to clean")
        delete data.figma
        return pipe(
          writeTextFile(MCP_AUTH_FILE, JSON.stringify(data, null, 2)),
          Effect.tap(() => info("cleaned stale figma auth")),
        )
      }),
    )
  }),
)

// ── main ────────────────────────────────────────────────────────────

const main = pipe(
  checkAlreadyConfigured,
  Effect.flatMap(() => resolveCredentials),
  Effect.flatMap(() => patchConfig),
  Effect.flatMap(() => cleanStaleAuth),
  Effect.flatMap(() => info("done. now run:")),
  Effect.tap(() => Effect.sync(() => console.log("\n  opencode mcp auth figma\n"))),
  Effect.tap(() => info("this will open your browser to complete the OAuth flow.")),
  Effect.catchAll((err) => {
    if (err === "already_configured") {
      return pipe(
        info(`figma MCP already configured in ${OPENCODE_CONFIG}`),
        Effect.tap(() => info("to re-auth: opencode mcp auth figma")),
      )
    }
    return Effect.sync(() => {
      console.error(`error: ${err instanceof SetupError ? err.message : err}`)
      process.exit(1)
    })
  }),
  Effect.provide(FetchHttpClient.layer),
  Effect.provide(BunFileSystem.layer),
)

Effect.runPromise(main)
