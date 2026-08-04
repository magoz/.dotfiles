import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { KeyId } from "@earendil-works/pi-tui";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const CONFIG_FILE_NAME = "context-budget.json";
const ENTRY_TYPE = "context-budget-profile";
const STATUS_KEY = "context-budget";
const DEFAULT_RESERVE_TOKENS = 16_384;
const DEFAULT_SHORTCUT = "alt+shift+c";
const SOL_MODEL_KEY = "openai-codex/gpt-5.6-sol";

type AnyModel = Model<Api> | Model<any>;

interface ModelBudgetConfig {
  defaultProfile: string;
  profiles: Record<string, number>;
}

interface ContextBudgetConfig {
  shortcut: KeyId;
  models: Record<string, ModelBudgetConfig>;
}

interface PendingProfile {
  model: string;
  profile: string;
}

interface CompactionStatus {
  revision: number;
  status: string;
}

const DEFAULT_CONFIG: ContextBudgetConfig = {
  shortcut: DEFAULT_SHORTCUT,
  models: {
    [SOL_MODEL_KEY]: {
      defaultProfile: "short",
      profiles: {
        short: 272_000,
        full: 1_050_000,
      },
    },
  },
};

function modelKey(model: AnyModel): string {
  return `${model.provider}/${model.id}`;
}

function profileBudget(
  modelConfig: ModelBudgetConfig | undefined,
  profile: string,
): number | undefined {
  if (!modelConfig || !Object.hasOwn(modelConfig.profiles, profile)) {
    return undefined;
  }
  return modelConfig.profiles[profile];
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${Number((tokens / 1_000_000).toFixed(2))}m`;
  }
  return `${Math.round(tokens / 1_000)}k`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SPECIAL_KEYS = new Set([
  "escape",
  "esc",
  "enter",
  "return",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "clear",
  "home",
  "end",
  "pageUp",
  "pageDown",
  "up",
  "down",
  "left",
  "right",
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
]);
const SYMBOL_KEYS = new Set(
  "`-=\\[];' ,./!@#$%^&*()_+|~{}:<>?".replace(" ", "").split(""),
);

function isKeyId(value: string): value is KeyId {
  let remainder = value;
  const modifiers = new Set<string>();

  while (true) {
    const match = /^(ctrl|shift|alt|super)\+/.exec(remainder);
    if (!match) break;
    const modifier = match[1]!;
    if (modifiers.has(modifier)) return false;
    modifiers.add(modifier);
    remainder = remainder.slice(match[0].length);
  }

  return (
    /^[a-z0-9]$/.test(remainder) ||
    SPECIAL_KEYS.has(remainder) ||
    SYMBOL_KEYS.has(remainder)
  );
}

function mergeConfig(
  base: ContextBudgetConfig,
  input: unknown,
  options: { allowShortcut?: boolean } = {},
): ContextBudgetConfig {
  if (!isRecord(input)) throw new Error("configuration must be a JSON object");

  let shortcut = base.shortcut;
  if (options.allowShortcut !== false && input.shortcut !== undefined) {
    const candidate =
      typeof input.shortcut === "string" ? input.shortcut.trim() : "";
    if (!isKeyId(candidate)) {
      throw new Error('"shortcut" must be a valid Pi key identifier');
    }
    shortcut = candidate;
  }
  const models = { ...base.models };

  if (input.models !== undefined) {
    if (!isRecord(input.models)) throw new Error('"models" must be an object');

    for (const [key, rawModel] of Object.entries(input.models)) {
      if (!isRecord(rawModel)) throw new Error(`model "${key}" must be an object`);
      if (!isRecord(rawModel.profiles)) {
        throw new Error(`model "${key}" must define a "profiles" object`);
      }

      const profiles: Record<string, number> = {};
      for (const [name, rawBudget] of Object.entries(rawModel.profiles)) {
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(name) || name === "status") {
          throw new Error(
            `profile "${key}/${name}" must use lowercase letters, numbers, dashes, or underscores and must not be named "status"`,
          );
        }
        if (
          typeof rawBudget !== "number" ||
          !Number.isInteger(rawBudget) ||
          rawBudget <= DEFAULT_RESERVE_TOKENS
        ) {
          throw new Error(
            `profile "${key}/${name}" must be an integer greater than ${DEFAULT_RESERVE_TOKENS}`,
          );
        }
        profiles[name] = rawBudget;
      }

      const names = Object.keys(profiles);
      if (names.length < 2) {
        throw new Error(`model "${key}" must define at least two profiles`);
      }

      const requestedDefault =
        typeof rawModel.defaultProfile === "string"
          ? rawModel.defaultProfile
          : undefined;
      const defaultProfile = requestedDefault ?? names[0]!;
      if (!Object.hasOwn(profiles, defaultProfile)) {
        throw new Error(
          `default profile "${defaultProfile}" is not defined for model "${key}"`,
        );
      }

      models[key] = { defaultProfile, profiles };
    }
  }

  return { shortcut, models };
}

function readConfigFile(
  path: string,
  base: ContextBudgetConfig,
  options: { allowShortcut?: boolean } = {},
): { config: ContextBudgetConfig; error?: string } {
  if (!existsSync(path)) return { config: base };

  try {
    return {
      config: mergeConfig(base, JSON.parse(readFileSync(path, "utf8")), options),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { config: base, error: `${path}: ${message}` };
  }
}

function savedProfile(
  entries: readonly unknown[],
  key: string,
  modelConfig: ModelBudgetConfig,
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index] as {
      type?: string;
      customType?: string;
      data?: { model?: unknown; profile?: unknown };
    };
    if (
      entry.type === "custom" &&
      entry.customType === ENTRY_TYPE &&
      entry.data?.model === key &&
      typeof entry.data.profile === "string" &&
      Object.hasOwn(modelConfig.profiles, entry.data.profile)
    ) {
      return entry.data.profile;
    }
  }
  return undefined;
}

export default function contextBudgetExtension(pi: ExtensionAPI): void {
  const globalResult = readConfigFile(
    join(getAgentDir(), CONFIG_FILE_NAME),
    DEFAULT_CONFIG,
  );
  let configuration = globalResult.config;
  let activeProfiles = new Map<string, string>();
  let pendingProfile: PendingProfile | undefined;
  let applying = false;
  let statusRevision = 0;
  let compactionInFlight = false;
  let compactionStatus: CompactionStatus | undefined;

  function configFor(model: AnyModel | undefined): ModelBudgetConfig | undefined {
    return model ? configuration.models[modelKey(model)] : undefined;
  }

  async function applyProfile(
    profile: string,
    ctx: ExtensionContext,
    options: { persist?: boolean } = {},
  ): Promise<boolean> {
    const model = ctx.model;
    const key = model ? modelKey(model) : undefined;
    const modelConfig = configFor(model);
    const contextWindow = profileBudget(modelConfig, profile);

    if (!model || !key || !modelConfig || contextWindow === undefined) {
      ctx.ui.notify(
        `Context Budget is not configured for ${key ?? "the current model"}.`,
        "warning",
      );
      return false;
    }

    const previousContextWindow = model.contextWindow;
    // contextWindow is local Pi metadata; the provider request only sends the
    // unchanged model id. Mutate synchronously so an idle selection cannot race
    // a newly started turn while waiting on authentication or model switching.
    model.contextWindow = contextWindow;

    activeProfiles.set(key, profile);
    if (options.persist !== false) {
      pi.appendEntry(ENTRY_TYPE, { model: key, profile });
    }

    const revision = ++statusRevision;
    const status = `ctx:${formatTokens(contextWindow)}`;
    compactionStatus = undefined;
    ctx.ui.setStatus(STATUS_KEY, status);

    const usage = ctx.getContextUsage();
    if (
      usage?.tokens !== null &&
      usage?.tokens !== undefined &&
      contextWindow < previousContextWindow &&
      usage.tokens > contextWindow - DEFAULT_RESERVE_TOKENS
    ) {
      compactionStatus = { revision, status };
      ctx.ui.setStatus(STATUS_KEY, `${status} compacting`);
      if (!compactionInFlight) {
        compactionInFlight = true;
        const finishCompaction = (error?: Error) => {
          compactionInFlight = false;
          const latest = compactionStatus;
          compactionStatus = undefined;
          if (!latest || latest.revision !== statusRevision) return;
          ctx.ui.setStatus(STATUS_KEY, latest.status);
          if (error) {
            ctx.ui.notify(`Context Budget compaction failed: ${error.message}`, "error");
          }
        };
        ctx.compact({
          onComplete: () => finishCompaction(),
          onError: (error: Error) => finishCompaction(error),
        });
      }
    }

    return true;
  }

  async function requestProfile(profile: string, ctx: ExtensionContext): Promise<void> {
    const model = ctx.model;
    const key = model ? modelKey(model) : undefined;
    const contextWindow = profileBudget(configFor(model), profile);
    if (!key || contextWindow === undefined) {
      ctx.ui.notify(
        `Context Budget profile "${profile}" is not configured for ${key ?? "the current model"}.`,
        "warning",
      );
      return;
    }

    if (!ctx.isIdle()) {
      pendingProfile = { model: key, profile };
      statusRevision++;
      compactionStatus = undefined;
      ctx.ui.setStatus(STATUS_KEY, `ctx:${formatTokens(contextWindow)} pending`);
      return;
    }

    await applyProfile(profile, ctx);
  }

  async function applyPendingProfile(ctx: ExtensionContext): Promise<void> {
    if (applying || !ctx.isIdle()) return;

    applying = true;
    try {
      while (pendingProfile && ctx.isIdle()) {
        const pending = pendingProfile;
        pendingProfile = undefined;
        if (!ctx.model || modelKey(ctx.model) !== pending.model) continue;
        await applyProfile(pending.profile, ctx);
      }
    } finally {
      applying = false;
    }
  }

  async function restoreCurrentProfile(ctx: ExtensionContext): Promise<void> {
    const model = ctx.model;
    const key = model ? modelKey(model) : undefined;
    const modelConfig = configFor(model);
    if (!key || !modelConfig) {
      statusRevision++;
      compactionStatus = undefined;
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }

    const restored = savedProfile(ctx.sessionManager.getBranch(), key, modelConfig);
    await applyProfile(restored ?? modelConfig.defaultProfile, ctx, { persist: false });
  }

  pi.on("session_start", async (_event, ctx) => {
    pendingProfile = undefined;
    activeProfiles = new Map();
    configuration = globalResult.config;

    let configError = globalResult.error;
    if (ctx.isProjectTrusted?.()) {
      const projectResult = readConfigFile(
        join(ctx.cwd, CONFIG_DIR_NAME, CONFIG_FILE_NAME),
        configuration,
        { allowShortcut: false },
      );
      configuration = {
        ...projectResult.config,
        // Shortcuts are registered before project trust is resolved, so only
        // the global file can configure the active keybinding.
        shortcut: globalResult.config.shortcut,
      };
      configError = projectResult.error ?? configError;
    }
    if (configError) {
      ctx.ui.notify(`Context Budget config error: ${configError}`, "error");
    }

    await restoreCurrentProfile(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    pendingProfile = undefined;
    activeProfiles.clear();
    await restoreCurrentProfile(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    const key = modelKey(event.model);
    if (pendingProfile && pendingProfile.model !== key) {
      pendingProfile = undefined;
    }

    const modelConfig = configuration.models[key];
    if (!modelConfig) {
      statusRevision++;
      compactionStatus = undefined;
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }

    const profile =
      activeProfiles.get(key) ??
      savedProfile(ctx.sessionManager.getBranch(), key, modelConfig) ??
      modelConfig.defaultProfile;
    await applyProfile(profile, ctx, { persist: false });
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await applyPendingProfile(ctx);
  });

  pi.on("session_shutdown", () => {
    pendingProfile = undefined;
    activeProfiles.clear();
    statusRevision++;
    compactionStatus = undefined;
    compactionInFlight = false;
  });

  pi.registerShortcut(configuration.shortcut, {
    description: "Toggle the current model's context budget",
    async handler(ctx) {
      const model = ctx.model;
      const key = model ? modelKey(model) : undefined;
      const modelConfig = configFor(model);
      if (!key || !modelConfig) {
        ctx.ui.notify(
          `Context Budget is not configured for ${key ?? "the current model"}.`,
          "warning",
        );
        return;
      }

      const names = Object.keys(modelConfig.profiles);
      const pendingCandidate = pendingProfile;
      const pending =
        pendingCandidate && pendingCandidate.model === key
          ? pendingCandidate.profile
          : undefined;
      const inferred = names.find(
        (name) => modelConfig.profiles[name] === model?.contextWindow,
      );
      const current = pending ?? activeProfiles.get(key) ?? inferred ?? modelConfig.defaultProfile;
      const currentIndex = Math.max(0, names.indexOf(current));
      const next = names[(currentIndex + 1) % names.length]!;
      await requestProfile(next, ctx);
    },
  });

  pi.registerCommand("context-budget", {
    description: "Select the active model's context-window budget",
    getArgumentCompletions(prefix: string) {
      const values = [
        ...new Set([
          ...Object.values(configuration.models).flatMap((model) =>
            Object.keys(model.profiles),
          ),
          "status",
        ]),
      ];
      const matches = values.filter((value) =>
        value.startsWith(prefix.trim().toLowerCase()),
      );
      return matches.length > 0
        ? matches.map((value) => ({ value, label: value }))
        : null;
    },
    async handler(args, ctx) {
      const action = args.trim().toLowerCase();
      if (!action) {
        const model = ctx.model;
        const key = model ? modelKey(model) : undefined;
        const modelConfig = configFor(model);
        if (!key || !modelConfig) {
          ctx.ui.notify(
            `Context Budget is not configured for ${key ?? "the current model"}.`,
            "warning",
          );
          return;
        }

        const choices = Object.entries(modelConfig.profiles).map(
          ([name, budget]) => `${name} — ${formatTokens(budget)}`,
        );
        const selected = await ctx.ui.select(`Context budget for ${key}`, choices);
        if (!selected) return;
        const selectedIndex = choices.indexOf(selected);
        if (selectedIndex < 0) return;
        await requestProfile(Object.keys(modelConfig.profiles)[selectedIndex]!, ctx);
        return;
      }

      if (action !== "status") {
        await requestProfile(action, ctx);
        return;
      }

      const model = ctx.model;
      const key = model ? modelKey(model) : undefined;
      const active = key ? activeProfiles.get(key) : undefined;
      const pendingCandidate = pendingProfile;
      const pending =
        pendingCandidate && pendingCandidate.model === key
          ? pendingCandidate.profile
          : undefined;
      ctx.ui.notify(
        key && configFor(model)
          ? `Context Budget for ${key}: ${active ?? "unresolved"}${pending ? ` (${pending} pending)` : ""}; ${formatTokens(model!.contextWindow)} effective.`
          : `Context Budget is not configured for ${key ?? "the current model"}.`,
        "info",
      );
    },
  });
}
