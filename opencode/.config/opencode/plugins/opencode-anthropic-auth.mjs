// Source: https://github.com/seaweeduk/opencode-anthropic-auth
// Commit: 072096f0a1dcaac2fd0f0eff611a64982d483e84
import { createHash, randomUUID } from "node:crypto";
import { generatePKCE } from "@openauthjs/openauth/pkce";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_CODE_VERSION = "2.1.112";
const CLAUDE_CODE_ENTRYPOINT = "sdk-cli";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CODE_CALLBACK_URL = "https://platform.claude.com/oauth/code/callback";
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

function stripToolPrefix(text) {
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

function getBodyModel(body) {
  if (typeof body !== "string") return "";

  try {
    const parsed = JSON.parse(body);
    return typeof parsed.model === "string" ? parsed.model : "";
  } catch {
    return "";
  }
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

function ensureSystemArray(parsed) {
  if (Array.isArray(parsed.system)) return;
  if (typeof parsed.system === "string") {
    parsed.system = [parsed.system];
    return;
  }
  parsed.system = [];
}

function ensureSystemIdentity(parsed) {
  ensureSystemArray(parsed);

  const hasIdentity = parsed.system.some((entry) =>
    getSystemEntryText(entry).startsWith(SYSTEM_IDENTITY),
  );

  if (!hasIdentity) parsed.system.unshift(SYSTEM_IDENTITY);
}

function ensureBillingHeader(parsed) {
  if (!Array.isArray(parsed.messages)) return;

  ensureSystemArray(parsed);
  parsed.system = parsed.system.filter(
    (entry) => !getSystemEntryText(entry).startsWith(BILLING_PREFIX),
  );
  parsed.system.unshift({
    type: "text",
    text: buildBillingHeaderValue(parsed.messages),
  });
}

function getSystemEntryText(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.text === "string") return entry.text;
  return "";
}

function withSystemEntryText(entry, text) {
  if (typeof entry === "string") return text;
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

  if (movedSystemTexts.length === 0) {
    parsed.system = keptSystemEntries;
    return;
  }

  parsed.system = keptSystemEntries;

  const relocatedText = movedSystemTexts.join("\n\n");

  if (typeof firstUserMessage.content === "string") {
    firstUserMessage.content = `${relocatedText}\n\n${firstUserMessage.content}`;
    return;
  }

  if (Array.isArray(firstUserMessage.content)) {
    firstUserMessage.content.unshift({
      type: "text",
      text: relocatedText,
    });
  }
}

/**
 * @param {"max" | "console"} mode
 */
async function authorize(mode) {
  const pkce = await generatePKCE();
  const state = randomUUID().replace(/-/g, "");

  const url = new URL(
    mode === "console"
      ? "https://platform.claude.com/oauth/authorize"
      : "https://claude.ai/oauth/authorize",
    import.meta.url,
  );
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", CODE_CALLBACK_URL);
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return {
    url: url.toString(),
    verifier: pkce.verifier,
    state,
  };
}

function parseCallbackInput(input) {
  const trimmed = input.trim();

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (code && state) return { code, state };
  } catch {
    // Fall through to legacy/manual formats.
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

/**
 * @param {string} code
 * @param {string} verifier
 * @param {string | undefined} expectedState
 */
async function exchange(code, verifier, expectedState) {
  const callback = parseCallbackInput(code);
  if (!callback) return { type: "failed" };
  if (expectedState && callback.state !== expectedState) {
    return { type: "failed" };
  }

  const result = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "User-Agent": getUserAgent(),
    },
    body: JSON.stringify({
      code: callback.code,
      state: callback.state,
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: CODE_CALLBACK_URL,
      code_verifier: verifier,
    }),
  });
  if (!result.ok)
    return {
      type: "failed",
    };
  const json = await result.json();
  return {
    type: "success",
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

/**
 * @type {import('@opencode-ai/plugin').Plugin}
 */
export async function AnthropicAuthPlugin({ client }) {
  return {
    "experimental.chat.system.transform": (input, output) => {
      if (input.model?.providerID !== "anthropic") return;
      if (!Array.isArray(output.system)) output.system = [];

      const hasIdentity = output.system.some((entry) =>
        getSystemEntryText(entry).startsWith(SYSTEM_IDENTITY),
      );

      if (!hasIdentity) output.system.unshift(SYSTEM_IDENTITY);
    },
    auth: {
      provider: "anthropic",
      async loader(getAuth, provider) {
        const auth = await getAuth();
        if (auth.type === "oauth") {
          // zero out cost for max plan
          for (const model of Object.values(provider.models)) {
            model.cost = {
              input: 0,
              output: 0,
              cache: {
                read: 0,
                write: 0,
              },
            };
          }
          let refreshPromise = null;

          return {
            apiKey: "",
            async fetch(input, init) {
              const auth = await getAuth();
              if (auth.type !== "oauth") return fetch(input, init);
              if (!auth.access || !auth.expires || auth.expires < Date.now()) {
                if (!refreshPromise) {
                  refreshPromise = (async () => {
                    const freshAuth = await getAuth();
                    const refreshToken = freshAuth.refresh || auth.refresh;
                    const response = await fetch(TOKEN_URL, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json, text/plain, */*",
                        "User-Agent": getUserAgent(),
                      },
                      body: JSON.stringify({
                        grant_type: "refresh_token",
                        refresh_token: refreshToken,
                        client_id: CLIENT_ID,
                      }),
                    });
                    if (!response.ok) {
                      const errorBody = await response.text().catch(() => "");
                      throw new Error(
                        `Token refresh failed: ${response.status} ${errorBody}`.trim(),
                      );
                    }
                    const json = await response.json();
                    await client.auth.set({
                      path: {
                        id: "anthropic",
                      },
                      body: {
                        type: "oauth",
                        refresh: json.refresh_token,
                        access: json.access_token,
                        expires: Date.now() + json.expires_in * 1000,
                      },
                    });
                    auth.refresh = json.refresh_token;
                    auth.expires = Date.now() + json.expires_in * 1000;
                    return json.access_token;
                  })().finally(() => {
                    refreshPromise = null;
                  });
                }

                auth.access = await refreshPromise;
              }
              const requestInit = init ?? {};
              const modelId = getBodyModel(requestInit.body);

              const requestHeaders = new Headers();
              if (input instanceof Request) {
                input.headers.forEach((value, key) => {
                  requestHeaders.set(key, value);
                });
              }
              if (requestInit.headers) {
                if (requestInit.headers instanceof Headers) {
                  requestInit.headers.forEach((value, key) => {
                    requestHeaders.set(key, value);
                  });
                } else if (Array.isArray(requestInit.headers)) {
                  for (const [key, value] of requestInit.headers) {
                    if (typeof value !== "undefined") {
                      requestHeaders.set(key, String(value));
                    }
                  }
                } else {
                  for (const [key, value] of Object.entries(
                    requestInit.headers,
                  )) {
                    if (typeof value !== "undefined") {
                      requestHeaders.set(key, String(value));
                    }
                  }
                }
              }

              // Preserve all incoming beta headers while ensuring OAuth requirements
              const incomingBeta = requestHeaders.get("anthropic-beta") || "";
              const incomingBetasList = incomingBeta
                .split(",")
                .map((b) => b.trim())
                .filter(Boolean);

              const mergedBetas = [
                ...new Set([...getRequiredBetas(modelId), ...incomingBetasList]),
              ].join(",");

              requestHeaders.set("authorization", `Bearer ${auth.access}`);
              requestHeaders.set("anthropic-version", "2023-06-01");
              requestHeaders.set("anthropic-beta", mergedBetas);
              requestHeaders.set(
                "anthropic-dangerous-direct-browser-access",
                "true",
              );
              requestHeaders.set("x-app", "cli");
              requestHeaders.set("user-agent", getUserAgent());
              requestHeaders.set("x-client-request-id", randomUUID());
              requestHeaders.set("X-Claude-Code-Session-Id", SESSION_ID);
              for (const [key, value] of Object.entries(getStainlessHeaders())) {
                if (!requestHeaders.has(key)) requestHeaders.set(key, value);
              }
              requestHeaders.delete("x-api-key");

              let body = requestInit.body;
              if (body && typeof body === "string") {
                try {
                  const parsed = JSON.parse(body);

                  ensureSystemIdentity(parsed);
                  ensureBillingHeader(parsed);

                  // Anthropic fingerprints OAuth requests by system[]
                  // content. Keep only Claude identity + billing header in
                  // system[], move all other system prompt content into the
                  // first user message.
                  relocateNonCoreSystemEntries(parsed);

                  stripUnsupportedEffort(parsed);

                  // Add prefix to tools definitions
                  if (parsed.tools && Array.isArray(parsed.tools)) {
                    parsed.tools = parsed.tools.map((tool) => ({
                      ...tool,
                      name: tool.name ? prefixName(tool.name) : tool.name,
                    }));
                  }
                  // Add prefix to tool_use blocks in messages
                  if (parsed.messages && Array.isArray(parsed.messages)) {
                    parsed.messages = parsed.messages.map((msg) => {
                      if (msg.content && Array.isArray(msg.content)) {
                        msg.content = msg.content.map((block) => {
                          if (block.type === "tool_use" && block.name) {
                            return {
                              ...block,
                              name: prefixName(block.name),
                            };
                          }
                          return block;
                        });
                      }
                      return msg;
                    });
                  }
                  body = JSON.stringify(parsed);
                } catch (e) {
                  // ignore parse errors
                }
              }

              let requestInput = input;
              let requestUrl = null;
              try {
                if (typeof input === "string" || input instanceof URL) {
                  requestUrl = new URL(input.toString());
                } else if (input instanceof Request) {
                  requestUrl = new URL(input.url);
                }
              } catch {
                requestUrl = null;
              }

              if (
                requestUrl &&
                requestUrl.pathname === "/v1/messages" &&
                !requestUrl.searchParams.has("beta")
              ) {
                requestUrl.searchParams.set("beta", "true");
                requestInput =
                  input instanceof Request
                    ? new Request(requestUrl.toString(), input)
                    : requestUrl;
              }

              const response = await fetch(requestInput, {
                ...requestInit,
                body,
                headers: requestHeaders,
              });

              // Transform streaming response to rename tools back
              if (response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                const encoder = new TextEncoder();
                let buffer = "";

                const stream = new ReadableStream({
                  async pull(controller) {
                    for (;;) {
                      const boundary = buffer.indexOf("\n\n");
                      if (boundary !== -1) {
                        const event = buffer.slice(0, boundary + 2);
                        buffer = buffer.slice(boundary + 2);
                        controller.enqueue(encoder.encode(stripToolPrefix(event)));
                        return;
                      }

                      const { done, value } = await reader.read();
                      if (done) {
                        if (buffer) {
                          controller.enqueue(encoder.encode(stripToolPrefix(buffer)));
                        }
                        controller.close();
                        return;
                      }

                      buffer += decoder.decode(value, { stream: true });
                    }
                  },
                });

                return new Response(stream, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                });
              }

              return response;
            },
          };
        }

        return {};
      },
      methods: [
        {
          label: "Claude Pro/Max",
          type: "oauth",
          authorize: async () => {
            const { url, verifier, state } = await authorize("max");
            return {
              url: url,
              instructions: "Paste the authorization code here: ",
              method: "code",
              callback: async (code) => {
                const credentials = await exchange(code, verifier, state);
                return credentials;
              },
            };
          },
        },
        {
          label: "Create an API Key",
          type: "oauth",
          authorize: async () => {
            const { url, verifier, state } = await authorize("console");
            return {
              url: url,
              instructions: "Paste the authorization code here: ",
              method: "code",
              callback: async (code) => {
                const credentials = await exchange(code, verifier, state);
                if (credentials.type === "failed") return credentials;
                const result = await fetch(
                  `https://api.anthropic.com/api/oauth/claude_cli/create_api_key`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      authorization: `Bearer ${credentials.access}`,
                    },
                  },
                ).then((r) => r.json());
                return { type: "success", key: result.raw_key };
              },
            };
          },
        },
        {
          provider: "anthropic",
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  };
}
