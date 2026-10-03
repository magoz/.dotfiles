// `subs-claude` gateway plugin entry. Separate plugin directory so the
// direct-mode plugin (`../index.mjs`) can never take gateway shaping down with
// it: OpenCode only warns when a plugin fails to load.
//
// Startup stays light: setup validates config and registers hooks; the
// shaping module loads on the first subs-claude request (cached).

// Keep in sync with ANTHROPIC_GATEWAY_PROVIDERS in shaping.mjs (static copy
// so setup does not load the shaping module; index.test.mjs pins equality).
export const GATEWAY_PROVIDERS = Object.freeze(["subs-claude"]);
export const GATEWAY_ORIGIN_ENV = "OPENCODE_SUBS_CLAUDE_GATEWAY_ORIGIN";
const SEMANTIC_HOOKS = Object.freeze(["context", "compaction", "generate", "title"]);

let shapingModule;
function loadShaping() {
  shapingModule ??= import("./shaping.mjs");
  return shapingModule;
}

/**
 * Register `subs-claude` hooks on an OpenCode session API.
 * - `http.request` (every kind): content shaping, harness-header removal and
 *   sentinel -> gateway re-targeting; throws on failure (fail closed).
 * - `context`/`compaction`/`generate`/`title`: drop reasoning OpenCode would
 *   lower to plain assistant text.
 * Returns an async disposer.
 */
export async function registerGatewayHooks(session, options = {}) {
  if (typeof session?.hook !== "function") {
    throw new Error("OpenCode session hooks unavailable; subs-claude requests would stay on the sentinel");
  }
  const providers = options.providers ?? GATEWAY_PROVIDERS;
  const gatewayOrigin = options.gatewayOrigin;
  const registrations = [];
  const dispose = async () => {
    for (const registration of registrations.splice(0)) await registration?.dispose?.();
  };

  try {
    for (const providerID of providers) {
      registrations.push(
        await session.hook(
          "http.request",
          async (event) => (await loadShaping()).shapeGatewayHttpRequest(event, { gatewayOrigin }),
          { providerID },
        ),
      );
      for (const name of SEMANTIC_HOOKS) {
        registrations.push(
          await session.hook(
            name,
            async (event) => (await loadShaping()).dropUnreplayableReasoning(event),
            { providerID },
          ),
        );
      }
    }
  } catch (cause) {
    await dispose();
    throw cause;
  }
  return dispose;
}

export default {
  id: "magoz.subs-claude-gateway",
  setup: async (ctx) =>
    registerGatewayHooks(ctx.session, {
      gatewayOrigin: process.env[GATEWAY_ORIGIN_ENV] || undefined,
    }),
};
