import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 15_000;

export interface SubscriptionWindow {
  label: string;
  remainingPercent: number;
  resetsAt: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWindow(value: unknown, label: string): SubscriptionWindow | undefined {
  if (!isRecord(value)) return undefined;

  const utilization = value.utilization;
  const resetsAt = value.resets_at;
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) return undefined;
  if (typeof resetsAt !== "string") return undefined;

  const resetTimestamp = Date.parse(resetsAt);
  if (!Number.isFinite(resetTimestamp)) return undefined;

  return {
    label,
    remainingPercent: Math.round(Math.max(0, Math.min(100, 100 - utilization))),
    resetsAt: resetTimestamp,
  };
}

export function normalizeAnthropicUsage(payload: unknown): SubscriptionWindow[] {
  if (!isRecord(payload)) return [];
  return [
    normalizeWindow(payload.five_hour, "5h"),
    normalizeWindow(payload.seven_day, "7d"),
  ].filter((window): window is SubscriptionWindow => window !== undefined);
}

function formatWindowLabel(seconds: number | undefined, fallback: string): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return fallback;
  if (seconds % (24 * 60 * 60) === 0) return `${seconds / (24 * 60 * 60)}d`;
  if (seconds % (60 * 60) === 0) return `${seconds / (60 * 60)}h`;
  return fallback;
}

function normalizeCodexWindow(value: unknown, fallbackLabel: string): SubscriptionWindow | undefined {
  if (!isRecord(value)) return undefined;

  const usedPercent = value.used_percent;
  const resetsAt = value.reset_at;
  const windowSeconds = value.limit_window_seconds;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return undefined;
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) return undefined;

  return {
    label: formatWindowLabel(
      typeof windowSeconds === "number" ? windowSeconds : undefined,
      fallbackLabel,
    ),
    remainingPercent: Math.round(Math.max(0, Math.min(100, 100 - usedPercent))),
    resetsAt: resetsAt * 1_000,
  };
}

export function normalizeCodexUsage(payload: unknown): SubscriptionWindow[] {
  if (!isRecord(payload) || !isRecord(payload.rate_limit)) return [];
  return [
    normalizeCodexWindow(payload.rate_limit.primary_window, "5h"),
    normalizeCodexWindow(payload.rate_limit.secondary_window, "7d"),
  ].filter((window): window is SubscriptionWindow => window !== undefined);
}

function formatTimeRemaining(resetsAt: number, now: number): string {
  const totalMinutes = Math.max(0, Math.ceil((resetsAt - now) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${totalMinutes}m`;
}

export function formatSubscriptionUsage(
  windows: readonly SubscriptionWindow[],
  now = Date.now(),
): string | undefined {
  if (windows.length === 0) return undefined;
  return windows
    .map(
      (window) =>
        `${window.remainingPercent}% / ${formatTimeRemaining(window.resetsAt, now)} (${window.label})`,
    )
    .join(" · ");
}

interface ProviderUsageConfig {
  endpoint: string;
  expectedHost: string;
  normalize(payload: unknown): SubscriptionWindow[];
}

function providerUsageConfig(provider: string): ProviderUsageConfig | undefined {
  if (provider === "anthropic") {
    return {
      endpoint: ANTHROPIC_USAGE_URL,
      expectedHost: "api.anthropic.com",
      normalize: normalizeAnthropicUsage,
    };
  }
  if (provider === "openai-codex") {
    return {
      endpoint: CODEX_USAGE_URL,
      expectedHost: "chatgpt.com",
      normalize: normalizeCodexUsage,
    };
  }
  return undefined;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((header) => header.toLowerCase() === name.toLowerCase());
}

function modelUsesOfficialHost(baseUrl: string, expectedHost: string): boolean {
  try {
    return new URL(baseUrl).hostname === expectedHost;
  } catch {
    return false;
  }
}

export class SubscriptionUsageTracker {
  private windows: SubscriptionWindow[] = [];
  private generation = 0;
  private requestController: AbortController | undefined;
  private readonly onUpdate: () => void;

  constructor(onUpdate: () => void) {
    this.onUpdate = onUpdate;
  }

  getText(now = Date.now()): string | undefined {
    return formatSubscriptionUsage(this.windows, now);
  }

  async refresh(ctx: ExtensionContext): Promise<void> {
    const model = ctx.model;
    const config = model ? providerUsageConfig(model.provider) : undefined;
    const generation = ++this.generation;
    this.requestController?.abort();
    this.requestController = undefined;

    if (!model || !config || !modelUsesOfficialHost(model.baseUrl, config.expectedHost)) {
      this.setWindows([], generation);
      return;
    }

    const controller = new AbortController();
    this.requestController = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref?.();

    try {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) throw new Error(auth.error);

      const headers = { ...auth.headers };
      if (auth.apiKey && !hasHeader(headers, "authorization")) {
        headers.Authorization = `Bearer ${auth.apiKey}`;
      }
      if (!hasHeader(headers, "accept")) headers.Accept = "application/json";
      if (model.provider === "anthropic" && !hasHeader(headers, "anthropic-beta")) {
        headers["anthropic-beta"] = "oauth-2025-04-20";
      }

      const response = await fetch(config.endpoint, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Usage endpoint returned ${response.status}`);

      this.setWindows(config.normalize(await response.json()), generation);
    } catch {
      if (!controller.signal.aborted) this.setWindows([], generation);
    } finally {
      clearTimeout(timeout);
      if (this.requestController === controller) this.requestController = undefined;
    }
  }

  stop(): void {
    this.generation += 1;
    this.requestController?.abort();
    this.requestController = undefined;
    this.windows = [];
  }

  private setWindows(windows: SubscriptionWindow[], generation: number): void {
    if (generation !== this.generation) return;
    this.windows = windows;
    this.onUpdate();
  }
}
