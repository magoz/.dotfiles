// V1 source: https://github.com/seaweeduk/opencode-anthropic-auth
// Base commit: 072096f0a1dcaac2fd0f0eff611a64982d483e84
// V2 port: local OAuth integration + loopback request adapter.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { Plugin } from "@opencode-ai/plugin/v2";
import { Effect } from "effect";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_CODE_VERSION = "2.1.112";
const CLAUDE_CODE_ENTRYPOINT = "sdk-cli";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CODE_CALLBACK_URL = "https://platform.claude.com/oauth/code/callback";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages?beta=true";
const OAUTH_METHOD_ID = "claude-pro-max";
const SYSTEM_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";
const BILLING_PREFIX = "x-anthropic-billing-header:";
const TOOL_PREFIX = "mcp_";
const CCH_SALT = "59cf53e54c78";
const CCH_POSITIONS = [4, 7, 20];
const SESSION_ID = randomUUID();
const OAUTH_SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
];
const DEFAULT_REQUIRED_BETAS = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "prompt-caching-scope-2026-01-05",
  "context-management-2025-06-27",
  "advisor-tool-2026-03-01",
];
const TEXT_REPLACEMENTS = [
  {
    match: "if OpenCode honestly",
    replacement: "if the assistant honestly",
  },
  {
    match:
      "Here is some useful information about the environment you are running in:",
    replacement: "Environment context you are running in:",
  },
];
const HOP_BY_HOP_HEADERS = [
  "connection",
  "content-encoding",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

let refreshPromise;

function getClaudeCodeVersion() {
  return process.env.ANTHROPIC_CLI_VERSION || CLAUDE_CODE_VERSION;
}

function getUserAgent() {
  return (
    process.env.ANTHROPIC_USER_AGENT ||
    `claude-cli/${getClaudeCodeVersion()} (external, ${CLAUDE_CODE_ENTRYPOINT})`
  );
}

function getStainlessHeaders() {
  return {
    "x-stainless-arch": process.arch === "arm64" ? "arm64" : process.arch,
    "x-stainless-lang": "js",
    "x-stainless-os": process.platform === "darwin" ? "MacOS" : process.platform,
    "x-stainless-package-version": "0.81.0",
    "x-stainless-retry-count": "0",
    "x-stainless-runtime": "node",
    "x-stainless-runtime-version": process.version,
    "x-stainless-timeout": "600",
  };
}

function prefixName(name) {
  return `${TOOL_PREFIX}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function unprefixName(name) {
  if (name === "StructuredOutput") return name;
  return `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

export function stripToolPrefix(text) {
  return text.replace(
    /"name"\s*:\s*"mcp_([^"]+)"/g,
    (_match, name) => `"name": "${unprefixName(name)}"`,
  );
}

function replaceAllText(text, match, replacement) {
  return text.split(match).join(replacement);
}

function sanitizeSystemText(text) {
  let result = text;

  for (const rule of TEXT_REPLACEMENTS) {
    result = replaceAllText(result, rule.match, rule.replacement);
  }

  return result;
}

function extractFirstUserMessageText(messages) {
  const userMessage = messages.find((message) => message?.role === "user");
  if (!userMessage) return "";

  if (typeof userMessage.content === "string") return userMessage.content;

  if (Array.isArray(userMessage.content)) {
    const textBlock = userMessage.content.find(
      (block) => block?.type === "text" && typeof block.text === "string",
    );
    return textBlock?.text || "";
  }

  return "";
}

function computeCCH(messageText) {
  return createHash("sha256").update(messageText).digest("hex").slice(0, 5);
}

function computeVersionSuffix(messageText) {
  const chars = CCH_POSITIONS.map((index) => messageText[index] || "0").join(
    "",
  );

  return createHash("sha256")
    .update(`${CCH_SALT}${chars}${getClaudeCodeVersion()}`)
    .digest("hex")
    .slice(0, 3);
}

function buildBillingHeaderValue(messages) {
  const text = extractFirstUserMessageText(messages);
  const suffix = computeVersionSuffix(text);
  const cch = computeCCH(text);

  return (
    `${BILLING_PREFIX} ` +
    `cc_version=${getClaudeCodeVersion()}.${suffix}; ` +
    `cc_entrypoint=${CLAUDE_CODE_ENTRYPOINT}; ` +
    `cch=${cch};`
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getRequiredBetas(modelId) {
  const betas = (
    process.env.ANTHROPIC_BETA_FLAGS || DEFAULT_REQUIRED_BETAS.join(",")
  )
    .split(",")
    .map((beta) => beta.trim())
    .filter(Boolean);

  const lower = modelId.toLowerCase();
  const withoutHaikuUnsupported = lower.includes("haiku")
    ? betas.filter((beta) => beta !== "interleaved-thinking-2025-05-14")
    : betas;

  if (
    !lower.includes("haiku") &&
    (lower.includes("4-6") || lower.includes("4-7")) &&
    !withoutHaikuUnsupported.includes("effort-2025-11-24")
  ) {
    return [...withoutHaikuUnsupported, "effort-2025-11-24"];
  }

  return withoutHaikuUnsupported;
}

function stripUnsupportedEffort(parsed) {
  if (typeof parsed.model !== "string") return;
  if (!parsed.model.toLowerCase().includes("haiku")) return;

  if (isRecord(parsed.output_config)) {
    delete parsed.output_config.effort;
    if (Object.keys(parsed.output_config).length === 0) {
      delete parsed.output_config;
    }
  }

  if (isRecord(parsed.thinking)) {
    delete parsed.thinking.effort;
    if (Object.keys(parsed.thinking).length === 0) {
      delete parsed.thinking;
    }
  }
}

function textBlock(text) {
  return { type: "text", text };
}

function ensureSystemArray(parsed) {
  if (Array.isArray(parsed.system)) return;
  if (typeof parsed.system === "string") {
    parsed.system = [textBlock(parsed.system)];
    return;
  }
  parsed.system = [];
}

function ensureSystemIdentity(parsed) {
  ensureSystemArray(parsed);

  const hasIdentity = parsed.system.some((entry) =>
    getSystemEntryText(entry).startsWith(SYSTEM_IDENTITY),
  );

  if (!hasIdentity) parsed.system.unshift(textBlock(SYSTEM_IDENTITY));
}

function ensureBillingHeader(parsed) {
  if (!Array.isArray(parsed.messages)) return;

  ensureSystemArray(parsed);
  parsed.system = parsed.system.filter(
    (entry) => !getSystemEntryText(entry).startsWith(BILLING_PREFIX),
  );
  parsed.system.unshift(textBlock(buildBillingHeaderValue(parsed.messages)));
}

function getSystemEntryText(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.text === "string") return entry.text;
  return "";
}

function withSystemEntryText(entry, text) {
  if (typeof entry === "string") return textBlock(text);
  return {
    ...entry,
    text,
  };
}

function relocateNonCoreSystemEntries(parsed) {
  if (!Array.isArray(parsed.system) || !Array.isArray(parsed.messages)) return;

  const firstUserMessage = parsed.messages.find(
    (message) => message?.role === "user",
  );

  if (!firstUserMessage) return;

  const keptSystemEntries = [];
  const movedSystemTexts = [];

  for (const entry of parsed.system) {
    const text = getSystemEntryText(entry);

    if (!text) {
      keptSystemEntries.push(entry);
      continue;
    }

    if (text.startsWith(BILLING_PREFIX)) {
      keptSystemEntries.push(entry);
      continue;
    }

    if (text === SYSTEM_IDENTITY) {
      keptSystemEntries.push(withSystemEntryText(entry, SYSTEM_IDENTITY));
      continue;
    }

    if (text.startsWith(SYSTEM_IDENTITY)) {
      keptSystemEntries.push(withSystemEntryText(entry, SYSTEM_IDENTITY));

      const remainder = sanitizeSystemText(
        text.slice(SYSTEM_IDENTITY.length).trim(),
      );
      if (remainder) movedSystemTexts.push(remainder);

      continue;
    }

    const sanitized = sanitizeSystemText(text);
    if (sanitized) movedSystemTexts.push(sanitized);
  }

  parsed.system = keptSystemEntries;
  if (movedSystemTexts.length === 0) return;

  const relocatedText = movedSystemTexts.join("\n\n");

  if (typeof firstUserMessage.content === "string") {
    firstUserMessage.content = `${relocatedText}\n\n${firstUserMessage.content}`;
    return;
  }

  if (Array.isArray(firstUserMessage.content)) {
    firstUserMessage.content.unshift(textBlock(relocatedText));
  }
}

export function transformRequestBody(body) {
  const parsed = JSON.parse(body);
  if (!isRecord(parsed)) throw new Error("Anthropic request body must be an object");

  ensureSystemIdentity(parsed);
  ensureBillingHeader(parsed);
  relocateNonCoreSystemEntries(parsed);
  stripUnsupportedEffort(parsed);

  if (Array.isArray(parsed.tools)) {
    parsed.tools = parsed.tools.map((tool) => ({
      ...tool,
      name: typeof tool.name === "string" ? prefixName(tool.name) : tool.name,
    }));
  }

  if (Array.isArray(parsed.messages)) {
    parsed.messages = parsed.messages.map((message) => {
      if (!Array.isArray(message.content)) return message;
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === "tool_use" && typeof block.name === "string"
            ? { ...block, name: prefixName(block.name) }
            : block,
        ),
      };
    });
  }

  return {
    body: JSON.stringify(parsed),
    model: typeof parsed.model === "string" ? parsed.model : "",
  };
}

function generatePKCE() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function authorize() {
  const pkce = generatePKCE();
  const state = randomUUID().replace(/-/g, "");
  const url = new URL("https://claude.ai/oauth/authorize");
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", CODE_CALLBACK_URL);
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return { url: url.toString(), verifier: pkce.verifier, state };
}

export function parseCallbackInput(input) {
  const trimmed = input.trim();

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (code && state) return { code, state };
  } catch {
    // Fall through to manual formats.
  }

  const hashSplits = trimmed.split("#");
  if (hashSplits.length === 2 && hashSplits[0] && hashSplits[1]) {
    return { code: hashSplits[0], state: hashSplits[1] };
  }

  const params = new URLSearchParams(trimmed);
  const code = params.get("code");
  const state = params.get("state");
  if (code && state) return { code, state };

  return null;
}

async function tokenRequest(body) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "User-Agent": getUserAgent(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Token request failed: ${response.status} ${detail}`.trim());
  }

  const json = await response.json();
  if (!isRecord(json) || typeof json.access_token !== "string") {
    throw new Error("Token response missing access_token");
  }
  return json;
}

function oauthCredential(tokens, refreshFallback) {
  const refresh =
    typeof tokens.refresh_token === "string"
      ? tokens.refresh_token
      : refreshFallback;
  if (!refresh) throw new Error("Token response missing refresh_token");

  return {
    type: "oauth",
    methodID: OAUTH_METHOD_ID,
    refresh,
    access: tokens.access_token,
    expires:
      Date.now() +
      (typeof tokens.expires_in === "number" ? tokens.expires_in : 3600) * 1000,
  };
}

async function exchange(input, verifier, expectedState) {
  const callback = parseCallbackInput(input);
  if (!callback) throw new Error("Invalid authorization code");
  if (callback.state !== expectedState) throw new Error("Invalid OAuth state");

  const tokens = await tokenRequest({
    code: callback.code,
    state: callback.state,
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    redirect_uri: CODE_CALLBACK_URL,
    code_verifier: verifier,
  });
  return oauthCredential(tokens);
}

async function refresh(credential) {
  if (!refreshPromise) {
    refreshPromise = tokenRequest({
      grant_type: "refresh_token",
      refresh_token: credential.refresh,
      client_id: CLIENT_ID,
    })
      .then((tokens) => oauthCredential(tokens, credential.refresh))
      .finally(() => {
        refreshPromise = undefined;
      });
  }
  return refreshPromise;
}

function effectFromPromise(run) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      cause instanceof Error ? cause : new Error("Anthropic OAuth failed"),
  });
}

function requestHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  return headers;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function applyOAuthHeaders(headers, accessToken, model) {
  const incomingBetas = (headers.get("anthropic-beta") || "")
    .split(",")
    .map((beta) => beta.trim())
    .filter(Boolean);
  const betas = [...new Set([...getRequiredBetas(model), ...incomingBetas])];

  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("anthropic-version", "2023-06-01");
  headers.set("anthropic-beta", betas.join(","));
  headers.set("anthropic-dangerous-direct-browser-access", "true");
  headers.set("x-app", "cli");
  headers.set("user-agent", getUserAgent());
  headers.set("x-client-request-id", randomUUID());
  headers.set("x-claude-code-session-id", SESSION_ID);
  for (const [name, value] of Object.entries(getStainlessHeaders())) {
    if (!headers.has(name)) headers.set(name, value);
  }
  headers.delete("x-api-key");
}

function copyResponseHeaders(response, serverResponse) {
  response.headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.includes(name.toLowerCase())) {
      serverResponse.setHeader(name, value);
    }
  });
}

function sseBoundary(buffer) {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { index: crlf, length: 4 };
  }
  return { index: lf, length: 2 };
}

async function write(serverResponse, value) {
  if (!serverResponse.write(value)) await once(serverResponse, "drain");
}

async function pipeResponse(response, serverResponse) {
  serverResponse.statusCode = response.status;
  serverResponse.statusMessage = response.statusText;
  copyResponseHeaders(response, serverResponse);

  if (!response.body) {
    serverResponse.end();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    buffer += decoder.decode(part.value, { stream: true });

    for (;;) {
      const boundary = sseBoundary(buffer);
      if (!boundary) break;
      const end = boundary.index + boundary.length;
      await write(serverResponse, stripToolPrefix(buffer.slice(0, end)));
      buffer = buffer.slice(end);
    }
  }

  buffer += decoder.decode();
  if (buffer) await write(serverResponse, stripToolPrefix(buffer));
  serverResponse.end();
}

function sendError(response, status, message) {
  if (response.headersSent) {
    response.destroy(new Error(message));
    return;
  }
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(message);
}

async function handleProxy(request, response, proxyPath) {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method !== "POST" || url.pathname !== proxyPath) {
    sendError(response, 404, "Not found");
    return;
  }

  const headers = requestHeaders(request);
  const accessToken = headers.get("x-api-key");
  if (!accessToken) {
    sendError(response, 401, "Missing Anthropic credential");
    return;
  }

  const transformed = transformRequestBody(await readBody(request));
  applyOAuthHeaders(headers, accessToken, transformed.model);

  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  const upstream = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers,
    body: transformed.body,
    signal: controller.signal,
  });
  await pipeResponse(upstream, response);
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

async function startProxy() {
  const secret = randomUUID();
  const proxyPath = `/${secret}/v1/messages`;
  const server = createServer((request, response) => {
    void handleProxy(request, response, proxyPath).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Proxy failed";
      sendError(response, 502, message);
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Anthropic proxy failed to bind");
  }

  return {
    baseURL: `http://127.0.0.1:${address.port}/${secret}/v1`,
    close: () => closeServer(server),
  };
}

function zeroCost(cost) {
  return {
    ...cost,
    input: 0,
    output: 0,
    cache: { read: 0, write: 0 },
  };
}

export function setBaseURL(target, baseURL) {
  if (isRecord(target.api)) {
    target.api.url = baseURL;
    return;
  }

  target.settings = {
    ...(isRecord(target.settings) ? target.settings : {}),
    baseURL,
  };
}

export default Plugin.define({
  id: "magoz.anthropic-oauth",
  setup: async (ctx) => {
    const proxy = await startProxy();

    try {
      await ctx.integration.transform((integrations) => {
        integrations.method.update({
          integrationID: "anthropic",
          method: {
            id: OAUTH_METHOD_ID,
            type: "oauth",
            label: "Claude Pro/Max",
          },
          authorize: () =>
            effectFromPromise(async () => {
              const authorization = await authorize();
              return {
                mode: "code",
                url: authorization.url,
                instructions: "Paste the authorization code here.",
                callback: (code) =>
                  effectFromPromise(() =>
                    exchange(code, authorization.verifier, authorization.state),
                  ),
              };
            }),
          refresh: (credential) => effectFromPromise(() => refresh(credential)),
        });
      });

      await ctx.catalog.transform((catalog) => {
        const anthropic = catalog.provider.get("anthropic");
        if (!anthropic) return;

        catalog.provider.update("anthropic", (provider) => {
          setBaseURL(provider, proxy.baseURL);
        });
        for (const model of anthropic.models.values()) {
          catalog.model.update("anthropic", model.id, (draft) => {
            setBaseURL(draft, proxy.baseURL);
            draft.cost = draft.cost.map(zeroCost);
          });
        }
      });
    } catch (cause) {
      await proxy.close();
      throw cause;
    }

    return proxy.close;
  },
});
