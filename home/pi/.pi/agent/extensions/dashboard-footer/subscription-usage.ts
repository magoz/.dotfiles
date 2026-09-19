import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

const REQUEST_TIMEOUT_MS = 15_000;
const MINUTE = 60_000;

export interface SubscriptionWindow {
  label: string;
  remainingPercent: number;
  capacityPercent?: number;
  resetsAt?: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function remainingPercent(used: number): number {
  return Math.max(0, Math.min(100, 100 - used));
}

function normalizeAnthropicWindow(value: unknown, label: string): SubscriptionWindow | undefined {
  if (!isRecord(value)) return undefined;
  const used = finiteNumber(value.utilization);
  if (used === undefined) return undefined;
  const reset = typeof value.resets_at === "string" ? Date.parse(value.resets_at) : NaN;
  return { label, remainingPercent: remainingPercent(used), resetsAt: finiteNumber(reset) };
}

export function normalizeAnthropicUsage(payload: unknown): SubscriptionWindow[] {
  if (!isRecord(payload)) return [];
  return [
    normalizeAnthropicWindow(payload.five_hour, "5h"),
    normalizeAnthropicWindow(payload.seven_day, "7d"),
  ].filter((window): window is SubscriptionWindow => window !== undefined);
}

function formatWindowLabel(seconds: number | undefined, fallback: string): string {
  if (seconds === undefined || seconds <= 0) return fallback;
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return fallback;
}

function normalizeCodexWindow(value: unknown, label: string, now: number): SubscriptionWindow | undefined {
  if (!isRecord(value)) return undefined;
  const used = finiteNumber(value.used_percent);
  if (used === undefined) return undefined;
  const absolute = finiteNumber(value.reset_at);
  const relative = finiteNumber(value.reset_after_seconds);
  const resetsAt = absolute !== undefined ? absolute * 1_000
    : relative !== undefined ? now + Math.max(0, relative) * 1_000 : undefined;
  return {
    label: formatWindowLabel(finiteNumber(value.limit_window_seconds), label),
    remainingPercent: remainingPercent(used),
    resetsAt: finiteNumber(resetsAt),
  };
}

export function normalizeCodexUsage(payload: unknown, now = Date.now()): SubscriptionWindow[] {
  if (!isRecord(payload) || !isRecord(payload.rate_limit)) return [];
  return [
    normalizeCodexWindow(payload.rate_limit.primary_window, "5h", now),
    normalizeCodexWindow(payload.rate_limit.secondary_window, "7d", now),
  ].filter((window): window is SubscriptionWindow => window !== undefined);
}

function subsWindowLabel(value: JsonRecord): string | undefined {
  const durationMinutes = finiteNumber(value.durationMinutes);
  if (durationMinutes !== undefined && durationMinutes > 0) {
    return formatWindowLabel(durationMinutes * 60, "usage");
  }
  if (value.label === "5-hour") return "5h";
  if (value.label === "Weekly") return "7d";
  if (value.label === "Monthly") return "month";
  return typeof value.label === "string" && value.label.length > 0 ? value.label : undefined;
}

export function normalizeSubsCodexUsage(payload: unknown): SubscriptionWindow[] {
  if (!isRecord(payload) || !Array.isArray(payload.accounts)) return [];
  const accounts = payload.accounts.filter((account): account is JsonRecord =>
    isRecord(account) && account.provider === "codex");
  if (accounts.length === 0 || accounts.some((account) => account.status !== "fresh")) return [];

  const grouped = new Map<string, { label: string; remaining: number; capacity: number; resets: number[] }>();
  for (const account of accounts) {
    if (!Array.isArray(account.windows)) return [];
    for (const candidate of account.windows) {
      if (!isRecord(candidate)) continue;
      const remaining = finiteNumber(candidate.remainingPercent);
      const label = subsWindowLabel(candidate);
      if (remaining === undefined || !label) continue;
      const durationMinutes = finiteNumber(candidate.durationMinutes);
      const key = durationMinutes !== undefined ? `duration:${durationMinutes}` : `label:${label}`;
      const group = grouped.get(key) ?? { label, remaining: 0, capacity: 0, resets: [] };
      group.remaining += Math.max(0, Math.min(100, remaining));
      group.capacity += 100;
      if (typeof candidate.resetsAt === "string") {
        const reset = Date.parse(candidate.resetsAt);
        if (Number.isFinite(reset)) group.resets.push(reset);
      }
      grouped.set(key, group);
    }
  }

  return [...grouped.values()].map((group) => ({
    label: group.label,
    remainingPercent: group.remaining,
    capacityPercent: group.capacity,
    resetsAt: group.resets.length > 0 ? Math.min(...group.resets) : undefined,
  }));
}

function grokWindowLabel(type: unknown): string {
  if (type === "USAGE_PERIOD_TYPE_WEEKLY") return "7d";
  if (type === "USAGE_PERIOD_TYPE_MONTHLY") return "month";
  return "usage";
}

export function normalizeGrokUsage(payload: unknown): SubscriptionWindow[] {
  if (!isRecord(payload) || !isRecord(payload.config)) return [];
  const used = finiteNumber(payload.config.creditUsagePercent);
  if (used === undefined) return [];
  const period = isRecord(payload.config.currentPeriod) ? payload.config.currentPeriod : undefined;
  const reset = typeof period?.end === "string" ? Date.parse(period.end) : NaN;
  return [{
    label: grokWindowLabel(period?.type),
    remainingPercent: remainingPercent(used),
    resetsAt: finiteNumber(reset),
  }];
}

function normalizeOpencodeGoWindow(
  value: unknown,
  label: string,
  now: number,
): SubscriptionWindow | undefined {
  if (!isRecord(value)) return undefined;
  const used = finiteNumber(value.percent)
    ?? finiteNumber(value.usage_percent)
    ?? finiteNumber(value.usagePercent);
  if (used === undefined) return undefined;
  const resetsAtRaw = value.resetsAt ?? value.resets_at;
  const absolute = typeof resetsAtRaw === "string" ? Date.parse(resetsAtRaw) : finiteNumber(resetsAtRaw);
  const relative = finiteNumber(value.resets_in_seconds)
    ?? finiteNumber(value.resetInSec)
    ?? finiteNumber(value.reset_after_seconds);
  const resolvedReset = finiteNumber(absolute) !== undefined ? finiteNumber(absolute)
    : relative !== undefined ? now + Math.max(0, relative) * 1_000 : undefined;
  return {
    label,
    remainingPercent: remainingPercent(used),
    resetsAt: finiteNumber(resolvedReset),
  };
}

export function normalizeOpencodeGoUsage(payload: unknown, now = Date.now()): SubscriptionWindow[] {
  if (!isRecord(payload)) return [];
  const usage = isRecord(payload.usage) ? payload.usage : undefined;
  if (!usage) return [];
  return [
    normalizeOpencodeGoWindow(usage.rolling, "5h", now),
    normalizeOpencodeGoWindow(usage.weekly, "7d", now),
    normalizeOpencodeGoWindow(usage.monthly, "month", now),
  ].filter((window): window is SubscriptionWindow => window !== undefined);
}

export function normalizeZaiUsage(payload: unknown): SubscriptionWindow[] {
  if (!isRecord(payload)) return [];
  const data = isRecord(payload.data) ? payload.data : undefined;
  const limits = data && Array.isArray(data.limits) ? data.limits : undefined;
  if (!limits) return [];
  // Live plans report credit limits; older/token plans reported TOKENS_LIMIT.
  const tokenLimitTypes = new Set(["TOKENS_LIMIT", "CREDIT_LIMIT"]);
  const specs = [{ unit: 3, label: "5h" }, { unit: 6, label: "7d" }] as const;
  return specs.flatMap(({ unit, label }) => {
    const entry = limits.find((candidate): candidate is JsonRecord =>
      isRecord(candidate) && tokenLimitTypes.has(candidate.type as string) && candidate.unit === unit);
    if (!entry) return [];
    const used = finiteNumber(entry.percentage);
    if (used === undefined) return [];
    return [{ label, remainingPercent: remainingPercent(used), resetsAt: finiteNumber(entry.nextResetTime) }];
  });
}

export function quotaColor(remaining: number): "muted" | "warning" | "error" {
  if (remaining <= 10) return "error";
  if (remaining <= 30) return "warning";
  return "muted";
}

function formatTimeRemaining(resetsAt: number, now: number): string {
  if (resetsAt <= now) return "reset pending";
  const totalMinutes = Math.ceil((resetsAt - now) / MINUTE);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  return `${minutes}m`;
}

export function formatSubscriptionUsage(
  windows: readonly SubscriptionWindow[],
  now = Date.now(),
  theme?: Pick<Theme, "fg">,
  stale = false,
): string | undefined {
  if (windows.length === 0) return undefined;
  const fg = (color: "muted" | "warning" | "error", text: string) =>
    theme ? theme.fg(color, text) : text;
  const text = windows.map((window) => {
    const expired = window.resetsAt !== undefined && window.resetsAt <= now;
    const remaining = window.remainingPercent > 0 && window.remainingPercent < 1
      ? "<1" : `${Math.round(window.remainingPercent)}`;
    const capacity = window.capacityPercent ?? 100;
    const healthPercent = capacity > 0 ? window.remainingPercent / capacity * 100 : 0;
    const quotaText = capacity > 100 ? `${remaining}% of ${Math.round(capacity)}% left` : `${remaining}% left`;
    const quota = fg(stale || expired ? "muted" : quotaColor(healthPercent), quotaText);
    const reset = window.resetsAt === undefined ? "reset unknown" : formatTimeRemaining(window.resetsAt, now);
    return `${fg("muted", `${window.label} `)}${quota}${fg("muted", ` / ${reset}`)}`;
  }).join(fg("muted", " · "));
  return stale ? `${text}${fg("muted", " (stale)")}` : text;
}

interface ProviderUsageConfig {
  endpoint: string;
  origin: string;
  refreshMs: number;
  authKind: "oauth" | "api_key" | "none";
  normalize(payload: unknown, now: number): SubscriptionWindow[];
}

function providerUsageConfig(provider: string): ProviderUsageConfig | undefined {
  if (provider === "anthropic") return {
    endpoint: "https://api.anthropic.com/api/oauth/usage",
    origin: "https://api.anthropic.com",
    refreshMs: 10 * MINUTE,
    authKind: "oauth",
    normalize: normalizeAnthropicUsage,
  };
  if (provider === "openai-codex") return {
    endpoint: "https://chatgpt.com/backend-api/wham/usage",
    origin: "https://chatgpt.com",
    refreshMs: 5 * MINUTE,
    authKind: "oauth",
    normalize: normalizeCodexUsage,
  };
  if (provider === "subs-codex") return {
    endpoint: "http://127.0.0.1:8320/api/usage",
    origin: "http://127.0.0.1:8317",
    refreshMs: MINUTE,
    authKind: "none",
    normalize: normalizeSubsCodexUsage,
  };
  if (provider === "xai") return {
    endpoint: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
    origin: "https://api.x.ai",
    refreshMs: 5 * MINUTE,
    authKind: "oauth",
    normalize: normalizeGrokUsage,
  };
  if (provider === "opencode-go") return {
    endpoint: "https://opencode.ai/zen/go/v1/usage",
    origin: "https://opencode.ai",
    refreshMs: 5 * MINUTE,
    authKind: "api_key",
    normalize: (payload, now) => normalizeOpencodeGoUsage(payload, now),
  };
  if (provider === "zai") return {
    endpoint: "https://api.z.ai/api/monitor/usage/quota/limit",
    origin: "https://api.z.ai",
    refreshMs: 5 * MINUTE,
    authKind: "api_key",
    normalize: (payload) => normalizeZaiUsage(payload),
  };
  return undefined;
}

function usesOfficialOrigin(baseUrl: string, origin: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

function codexAccountId(authorization: string): string | undefined {
  try {
    const token = authorization.replace(/^Bearer\s+/i, "");
    const payload: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    const claim = isRecord(payload) ? payload["https://api.openai.com/auth"] : undefined;
    const id = isRecord(claim) ? claim.chatgpt_account_id : undefined;
    return typeof id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

interface UsageSnapshot {
  windows: SubscriptionWindow[];
  nextRefreshAt: number;
  stale: boolean;
}

// Only telemetry is cached, in this extension instance. Pi owns authentication;
// this class never reads auth files, registers providers, or selects models.
export class SubscriptionUsageTracker {
  private readonly snapshots = new Map<string, UsageSnapshot>();
  private activeKey: string | undefined;
  private requestController: AbortController | undefined;

  private readonly onUpdate: () => void;
  private readonly fetchUsage: typeof fetch;
  private readonly now: () => number;

  constructor(onUpdate: () => void, fetchUsage: typeof fetch = fetch, now: () => number = Date.now) {
    this.onUpdate = onUpdate;
    this.fetchUsage = fetchUsage;
    this.now = now;
  }

  getText(theme?: Pick<Theme, "fg">): string | undefined {
    const snapshot = this.activeKey ? this.snapshots.get(this.activeKey) : undefined;
    return snapshot ? formatSubscriptionUsage(snapshot.windows, this.now(), theme, snapshot.stale) : undefined;
  }

  async refresh(ctx: ExtensionContext): Promise<void> {
    const model = ctx.model;
    const config = model ? providerUsageConfig(model.provider) : undefined;
    const usesOAuth = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
    const authMatches = config?.authKind === "none"
      || (config?.authKind === "api_key" ? !usesOAuth : usesOAuth);
    const key = model && config && usesOfficialOrigin(model.baseUrl, config.origin)
      && authMatches ? model.provider : undefined;
    // Once logout/API-key mode is observed, the old account's allowance is no
    // longer valid even if a subsequent login happens before the TTL expires.
    if (!key && model) this.snapshots.delete(model.provider);
    if (key !== this.activeKey) {
      this.requestController?.abort();
      this.requestController = undefined;
      this.activeKey = key;
      this.onUpdate();
    }
    if (!key || !model || !config || this.requestController) return;
    const cached = this.snapshots.get(key);
    if (cached && this.now() < cached.nextRefreshAt) return;

    const controller = new AbortController();
    this.requestController = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    let nextRefreshAt = this.now() + config.refreshMs;
    try {
      const headers = new Headers({ Accept: "application/json" });
      if (config.authKind !== "none") {
        const auth = await abortable(ctx.modelRegistry.getApiKeyAndHeaders(model), controller.signal);
        controller.signal.throwIfAborted();
        if (!auth.ok) throw new Error("Usage authentication unavailable");
        const resolved = new Headers();
        // Pi provider headers use null to omit a header, not the string "null".
        for (const [name, value] of Object.entries(auth.headers ?? {})) {
          if (value !== null) resolved.set(name, value);
        }
        const authorization = resolved.get("authorization") ?? (auth.apiKey ? `Bearer ${auth.apiKey}` : undefined);
        if (!authorization) throw new Error("Usage authentication unavailable");
        // Do not forward arbitrary model headers to a different endpoint.
        headers.set("Authorization", authorization);
        if (model.provider === "anthropic") headers.set("anthropic-beta", "oauth-2025-04-20");
        if (model.provider === "xai") headers.set("X-XAI-Token-Auth", "xai-grok-cli");
        const accountId = resolved.get("chatgpt-account-id") ?? codexAccountId(authorization);
        if (model.provider === "openai-codex" && accountId) headers.set("ChatGPT-Account-Id", accountId);
      }
      const response = await this.fetchUsage(config.endpoint, {
        headers, signal: controller.signal, redirect: "error",
      });
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) {
          const seconds = Number(retryAfter);
          const retryAt = Number.isFinite(seconds) ? this.now() + Math.max(0, seconds) * 1_000 : Date.parse(retryAfter);
          if (Number.isFinite(retryAt)) nextRefreshAt = Math.max(nextRefreshAt, retryAt);
        }
      }
      if (!response.ok) throw new Error("Usage request failed");
      const windows = config.normalize(await response.json(), this.now());
      controller.signal.throwIfAborted();
      if (windows.length === 0) throw new Error("Usage windows unavailable");
      if (this.requestController === controller) {
        this.snapshots.set(key, { windows, nextRefreshAt, stale: false });
      }
    } catch {
      if (this.requestController === controller) {
        this.snapshots.set(key, { windows: cached?.windows ?? [], nextRefreshAt, stale: true });
      }
    } finally {
      clearTimeout(timeout);
      if (this.requestController === controller) {
        this.requestController = undefined;
        this.onUpdate();
      }
    }
  }

  stop(): void {
    this.requestController?.abort();
    this.requestController = undefined;
    this.activeKey = undefined;
    this.snapshots.clear();
  }
}
