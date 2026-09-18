import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  formatSubscriptionUsage,
  normalizeAnthropicUsage,
  normalizeCodexUsage,
  normalizeGrokUsage,
  normalizeOpencodeGoUsage,
  normalizeZaiUsage,
  quotaColor,
  SubscriptionUsageTracker,
} from "./subscription-usage.ts";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const MINUTE = 60_000;
const anthropicPayload = {
  five_hour: { utilization: 37, resets_at: "2026-08-11T14:14:00.000Z" },
  seven_day: { utilization: 28, resets_at: "2026-08-15T15:00:00.000Z" },
};
const codexPayload = {
  rate_limit: {
    primary_window: { used_percent: 37, limit_window_seconds: 18_000, reset_at: (NOW + 134 * MINUTE) / 1_000 },
    secondary_window: { used_percent: 28, limit_window_seconds: 604_800, reset_at: (NOW + 99 * 60 * MINUTE) / 1_000 },
  },
};
const EXPECTED = "5h 63% left / 2h 14m · 7d 72% left / 4d 3h";
const grokPayload = {
  config: {
    creditUsagePercent: 37,
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-08-04T12:00:00.000Z",
      end: "2026-08-11T14:14:00.000Z",
    },
    onDemandCap: { val: 5000 },
    onDemandUsed: { val: 300 },
    prepaidBalance: { val: 1250 },
    productUsage: [{ product: "PRODUCT_GROK_BUILD", usagePercent: 61.2 }],
  },
};
const GROK_EXPECTED = "7d 63% left / 2h 14m";

function defaultBaseUrl(provider: string) {
  if (provider === "anthropic") return "https://api.anthropic.com";
  if (provider === "xai") return "https://api.x.ai/v1";
  if (provider === "opencode-go") return "https://opencode.ai/zen/go/v1";
  if (provider === "zai") return "https://api.z.ai/api/coding/paas/v4";
  return "https://chatgpt.com/backend-api";
}

test("restores Anthropic and Codex remaining allowance and reset countdowns", () => {
  assert.equal(formatSubscriptionUsage(normalizeAnthropicUsage(anthropicPayload), NOW), EXPECTED);
  assert.equal(formatSubscriptionUsage(normalizeCodexUsage(codexPayload), NOW), EXPECTED);
});

test("parses Grok included-pool percent and exact weekly/monthly labels without trusting server strings", () => {
  assert.equal(formatSubscriptionUsage(normalizeGrokUsage(grokPayload), NOW), GROK_EXPECTED);
  assert.equal(formatSubscriptionUsage(normalizeGrokUsage({
    config: {
      creditUsagePercent: 28,
      currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY", end: "2026-08-15T15:00:00.000Z" },
    },
  }), NOW), "month 72% left / 4d 3h");
  assert.equal(formatSubscriptionUsage(normalizeGrokUsage({
    config: {
      creditUsagePercent: 42.5,
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        end: "2026-08-18T12:00:00.238389+00:00",
      },
    },
  }), NOW), "7d 58% left / 7d");
  const unknown = normalizeGrokUsage({
    config: {
      creditUsagePercent: 10,
      currentPeriod: { type: "USAGE_PERIOD_TYPE_DAILY", end: "2026-08-12T12:00:00Z" },
    },
  });
  assert.equal(unknown[0].label, "usage");
  assert.equal(formatSubscriptionUsage(unknown, NOW), "usage 90% left / 1d");
  assert.ok(!formatSubscriptionUsage(unknown, NOW)!.includes("USAGE_PERIOD"));
});

test("parses OpenCode Go rolling/weekly/monthly usage with fixed labels", () => {
  const payload = {
    usage: {
      rolling: { status: "ok", percent: 37, resetsAt: "2026-08-11T14:14:00.000Z" },
      weekly: { status: "ok", percent: 28, resetsAt: "2026-08-15T15:00:00.000Z" },
      monthly: { status: "ok", percent: 12, resetsAt: "2026-09-11T12:00:00.000Z" },
    },
  };
  const windows = normalizeOpencodeGoUsage(payload, NOW);
  assert.deepEqual(windows.map((w) => w.label), ["5h", "7d", "month"]);
  assert.equal(
    formatSubscriptionUsage(windows, NOW),
    "5h 63% left / 2h 14m · 7d 72% left / 4d 3h · month 88% left / 31d",
  );
});

test("OpenCode Go parsing is strict, preserves partial windows, and clamps percentages", () => {
  for (const payload of [null, [], {}, { usage: null }, { usage: {} }]) {
    assert.deepEqual(normalizeOpencodeGoUsage(payload, NOW), []);
  }
  for (const percent of [undefined, null, "", "50", true, NaN, Infinity]) {
    assert.deepEqual(normalizeOpencodeGoUsage({ usage: { rolling: { percent } } }, NOW), []);
  }
  assert.equal(normalizeOpencodeGoUsage({ usage: { rolling: { percent: -20 } } }, NOW)[0].remainingPercent, 100);
  assert.equal(normalizeOpencodeGoUsage({ usage: { rolling: { percent: 120 } } }, NOW)[0].remainingPercent, 0);
  assert.equal(
    formatSubscriptionUsage(normalizeOpencodeGoUsage({ usage: { rolling: { percent: 0 } } }, NOW), NOW),
    "5h 100% left / reset unknown",
  );
  // Relative resets and snake_case aliases are accepted without inventing a reset.
  const relative = normalizeOpencodeGoUsage({ usage: {
    rolling: { usage_percent: 10, resets_in_seconds: 90 },
    weekly: { usagePercent: 99.8 },
  } }, NOW);
  assert.equal(formatSubscriptionUsage(relative, NOW), "5h 90% left / 2m · 7d <1% left / reset unknown");
  const partial = normalizeOpencodeGoUsage({ usage: { monthly: { percent: 50, resetsAt: "2026-08-12T12:00:00Z" } } }, NOW);
  assert.equal(partial.length, 1);
  assert.equal(partial[0].label, "month");
  assert.equal(formatSubscriptionUsage(partial, NOW), "month 50% left / 1d");
});

test("parses Z.ai 5h/weekly token windows and ignores monthly web-search quota", () => {
  const payload = {
    code: 200,
    success: true,
    data: {
      level: "lite",
      limits: [
        { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 16, nextResetTime: NOW + 134 * MINUTE },
        { type: "TOKENS_LIMIT", unit: 6, number: 7, percentage: 4, nextResetTime: NOW + 99 * 60 * MINUTE },
        { type: "TIME_LIMIT", unit: 5, number: 1, percentage: 57, nextResetTime: NOW + 18 * 24 * 60 * MINUTE },
      ],
    },
  };
  const windows = normalizeZaiUsage(payload);
  assert.deepEqual(windows.map((w) => w.label), ["5h", "7d"]);
  assert.equal(formatSubscriptionUsage(windows, NOW), "5h 84% left / 2h 14m · 7d 96% left / 4d 3h");
});

test("Z.ai parsing is strict, preserves partial windows, and clamps percentages", () => {
  for (const payload of [null, [], {}, { data: null }, { data: {} }, { data: { limits: null } }, { data: { limits: [] } }]) {
    assert.deepEqual(normalizeZaiUsage(payload), []);
  }
  for (const percentage of [undefined, null, "", "50", true, NaN, Infinity]) {
    assert.deepEqual(normalizeZaiUsage({ data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, percentage }] } }), []);
  }
  assert.equal(normalizeZaiUsage({ data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, percentage: -20 }] } })[0].remainingPercent, 100);
  assert.equal(normalizeZaiUsage({ data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, percentage: 120 }] } })[0].remainingPercent, 0);
  assert.equal(
    formatSubscriptionUsage(normalizeZaiUsage({ data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, percentage: 0 }] } }), NOW),
    "5h 100% left / reset unknown",
  );
  // TIME_LIMIT entries and unknown units never render as token allowance.
  assert.deepEqual(normalizeZaiUsage({ data: { limits: [{ type: "TIME_LIMIT", unit: 5, percentage: 10 }] } }), []);
  assert.deepEqual(normalizeZaiUsage({ data: { limits: [{ type: "TOKENS_LIMIT", unit: 5, percentage: 10 }] } }), []);
  const partial = normalizeZaiUsage({ data: { limits: [{ type: "TOKENS_LIMIT", unit: 6, percentage: 50, nextResetTime: NOW + 24 * 60 * MINUTE }] } });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].label, "7d");
  assert.equal(formatSubscriptionUsage(partial, NOW), "7d 50% left / 1d");
});

test("strict parsing keeps missing/invalid data unknown, preserves partial windows, and clamps percentages", () => {
  for (const payload of [null, [], {}, { rate_limit: null }, { config: null }]) {
    assert.deepEqual(normalizeCodexUsage(payload), []);
    assert.deepEqual(normalizeAnthropicUsage(payload), []);
    assert.deepEqual(normalizeGrokUsage(payload), []);
    assert.deepEqual(normalizeZaiUsage(payload), []);
  }
  for (const utilization of [undefined, null, "", "50", true, NaN, Infinity]) {
    assert.deepEqual(normalizeAnthropicUsage({ five_hour: { utilization } }), []);
    assert.deepEqual(normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: utilization } } }), []);
    assert.deepEqual(normalizeGrokUsage({
      config: {
        creditUsagePercent: utilization,
        currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-08-18T00:00:00Z" },
      },
    }), []);
  }
  assert.equal(normalizeAnthropicUsage({ five_hour: { utilization: -20 } })[0].remainingPercent, 100);
  assert.equal(normalizeAnthropicUsage({ five_hour: { utilization: 120 } })[0].remainingPercent, 0);
  assert.equal(normalizeGrokUsage({ config: { creditUsagePercent: -20 } })[0].remainingPercent, 100);
  assert.equal(normalizeGrokUsage({ config: { creditUsagePercent: 120 } })[0].remainingPercent, 0);
  assert.equal(formatSubscriptionUsage(normalizeAnthropicUsage({ five_hour: { utilization: 0, resets_at: null } }), NOW),
    "5h 100% left / reset unknown");
  assert.equal(formatSubscriptionUsage(normalizeGrokUsage({ config: { creditUsagePercent: 0, currentPeriod: { type: 1 } } }), NOW),
    "usage 100% left / reset unknown");
  assert.deepEqual(normalizeGrokUsage({
    config: {
      onDemandUsed: { val: 300 },
      onDemandCap: { val: 5000 },
      prepaidBalance: { val: 1250 },
      productUsage: [{ product: "PRODUCT_GROK_BUILD", usagePercent: 61.2 }],
      monthlyLimit: { val: 10000 },
      used: { val: 2000 },
      billingPeriodEnd: "2026-08-18T12:00:00Z",
    },
  }), []);
  const ignoredSpend = normalizeGrokUsage({
    config: {
      creditUsagePercent: 40,
      currentPeriod: { end: "not-rfc3339" },
      productUsage: [{ usagePercent: 99 }],
      used: { val: 9999 },
      billingPeriodEnd: "2026-08-18T12:00:00Z",
    },
  });
  assert.equal(ignoredSpend[0].remainingPercent, 60);
  assert.equal(ignoredSpend[0].label, "usage");
  assert.equal(ignoredSpend[0].resetsAt, undefined);
  assert.equal(formatSubscriptionUsage([], NOW), undefined);
});

test("honors nonstandard Codex durations and relative resets without inventing a reset", () => {
  const windows = normalizeCodexUsage({ rate_limit: {
    primary_window: { used_percent: 10, limit_window_seconds: 30 * 86_400, reset_after_seconds: 90 },
    secondary_window: { used_percent: 99.8, limit_window_seconds: 1_800 },
  } }, NOW);
  assert.equal(formatSubscriptionUsage(windows, NOW), "30d 90% left / 2m · 30m <1% left / reset unknown");
  assert.equal(formatSubscriptionUsage(windows, NOW + 2 * MINUTE), "30d 90% left / reset pending · 30m <1% left / reset unknown");
});

test("theme-aware quota colors use each window; stale/expired values are muted", () => {
  assert.equal(quotaColor(0), "error");
  assert.equal(quotaColor(10), "error");
  assert.equal(quotaColor(10.1), "warning");
  assert.equal(quotaColor(30), "warning");
  assert.equal(quotaColor(30.1), "muted");
  const colors: string[] = [];
  const theme = { fg: (color: string, text: string) => { if (text.endsWith("% left")) colors.push(color); return text; } } as Pick<Theme, "fg">;
  const windows = [100, 30, 10].map((remainingPercent) => ({ label: "5h", remainingPercent, resetsAt: NOW + MINUTE }));
  formatSubscriptionUsage(windows, NOW, theme);
  assert.deepEqual(colors.splice(0), ["muted", "warning", "error"]);
  assert.match(formatSubscriptionUsage(windows, NOW, theme, true)!, /\(stale\)$/);
  assert.deepEqual(colors.splice(0), ["muted", "muted", "muted"]);
  formatSubscriptionUsage(windows, NOW + MINUTE, theme);
  assert.deepEqual(colors, ["muted", "muted", "muted"]);
});

function context(provider = "openai-codex", options: { oauth?: boolean; baseUrl?: string; headers?: Record<string, string | null>; apiKey?: string } = {}) {
  let authCalls = 0;
  const ctx = {
    model: { provider, id: "test-model", baseUrl: options.baseUrl ?? defaultBaseUrl(provider) },
    modelRegistry: {
      isUsingOAuth: () => options.oauth ?? true,
      getApiKeyAndHeaders: async () => {
        authCalls += 1;
        return { ok: true, apiKey: options.apiKey ?? "test-access-token", headers: options.headers ?? {} };
      },
    },
  } as unknown as ExtensionContext;
  return { ctx, authCalls: () => authCalls };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("ignores null provider headers instead of sending literal null credentials", async () => {
  const { ctx } = context("openai-codex", { headers: {
    authorization: null,
    "chatgpt-account-id": null,
  } });
  let sentHeaders: Headers | undefined;
  const tracker = new SubscriptionUsageTracker(() => {}, async (_url, init) => {
    sentHeaders = new Headers(init?.headers);
    return Response.json(codexPayload);
  }, () => NOW);
  await tracker.refresh(ctx);
  assert.equal(sentHeaders?.get("authorization"), "Bearer test-access-token");
  assert.equal(sentHeaders?.get("chatgpt-account-id"), null);
  assert.equal(tracker.getText(), EXPECTED);
  tracker.stop();
});

test("only requests official OAuth usage endpoints with allowlisted headers and no redirects", async () => {
  const cases = [
    ["openai-codex", "https://chatgpt.com/backend-api/wham/usage", codexPayload, EXPECTED],
    ["anthropic", "https://api.anthropic.com/api/oauth/usage", anthropicPayload, EXPECTED],
    ["xai", "https://cli-chat-proxy.grok.com/v1/billing?format=credits", grokPayload, GROK_EXPECTED],
  ] as const;
  for (const [provider, endpoint, payload, expected] of cases) {
    let calls = 0;
    const { ctx } = context(provider, { headers: {
      authorization: "Bearer test-resolved",
      "chatgpt-account-id": "test-account",
      "x-private-header": "not-for-usage",
      "x-userid": "should-not-send",
      "x-grok-client-version": "1.0.24",
      "x-grok-client-mode": "interactive",
    } });
    const tracker = new SubscriptionUsageTracker(() => {}, async (url, init) => {
      calls += 1;
      assert.equal(url, endpoint);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer test-resolved");
      assert.equal(headers.get("accept"), "application/json");
      assert.equal(headers.get("x-private-header"), null);
      assert.equal(headers.get("x-userid"), null);
      assert.equal(headers.get("x-grok-client-version"), null);
      assert.equal(headers.get("x-grok-client-mode"), null);
      assert.equal(headers.get("chatgpt-account-id"), provider === "openai-codex" ? "test-account" : null);
      assert.equal(headers.get("anthropic-beta"), provider === "anthropic" ? "oauth-2025-04-20" : null);
      assert.equal(headers.get("x-xai-token-auth"), provider === "xai" ? "xai-grok-cli" : null);
      assert.equal([...headers.keys()].sort().join(","), provider === "openai-codex"
        ? "accept,authorization,chatgpt-account-id"
        : provider === "anthropic" ? "accept,anthropic-beta,authorization"
        : "accept,authorization,x-xai-token-auth");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      return Response.json(payload);
    }, () => NOW);
    await tracker.refresh(ctx);
    await tracker.refresh(ctx);
    assert.equal(calls, 1);
    assert.equal(tracker.getText(), expected);
    tracker.stop();
  }
});

test("Codex account ID can come from Pi's resolved access token without reading auth files", async () => {
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url");
  const { ctx } = context("openai-codex", { apiKey: `test.${payload}.signature` });
  const tracker = new SubscriptionUsageTracker(() => {}, async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("chatgpt-account-id"), "test-account");
    return Response.json(codexPayload);
  }, () => NOW);
  await tracker.refresh(ctx);
  tracker.stop();
});

test("OpenCode Go uses API-key auth on the official origin with allowlisted headers", async () => {
  const goPayload = {
    usage: {
      rolling: { status: "ok", percent: 37, resetsAt: new Date(NOW + 134 * MINUTE).toISOString() },
      weekly: { status: "ok", percent: 28, resetsAt: new Date(NOW + 99 * 60 * MINUTE).toISOString() },
      monthly: { status: "ok", percent: 12, resetsAt: new Date(NOW + 31 * 24 * 60 * MINUTE).toISOString() },
    },
  };
  let calls = 0;
  const { ctx } = context("opencode-go", { oauth: false, headers: {
    authorization: "Bearer test-resolved",
    "x-private-header": "not-for-usage",
  } });
  const tracker = new SubscriptionUsageTracker(() => {}, async (url, init) => {
    calls += 1;
    assert.equal(url, "https://opencode.ai/zen/go/v1/usage");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-resolved");
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(headers.get("x-private-header"), null);
    assert.equal([...headers.keys()].sort().join(","), "accept,authorization");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return Response.json(goPayload);
  }, () => NOW);
  await tracker.refresh(ctx);
  await tracker.refresh(ctx);
  assert.equal(calls, 1);
  assert.equal(tracker.getText(), "5h 63% left / 2h 14m · 7d 72% left / 4d 3h · month 88% left / 31d");
  tracker.stop();
});

test("Z.ai uses API-key auth on the official origin with allowlisted headers", async () => {
  const zaiPayload = {
    code: 200,
    success: true,
    data: {
      limits: [
        { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 37, nextResetTime: NOW + 134 * MINUTE },
        { type: "TOKENS_LIMIT", unit: 6, number: 7, percentage: 28, nextResetTime: NOW + 99 * 60 * MINUTE },
        { type: "TIME_LIMIT", unit: 5, number: 1, percentage: 57 },
      ],
    },
  };
  let calls = 0;
  const { ctx } = context("zai", { oauth: false, headers: {
    authorization: "Bearer test-resolved",
    "x-private-header": "not-for-usage",
  } });
  const tracker = new SubscriptionUsageTracker(() => {}, async (url, init) => {
    calls += 1;
    assert.equal(url, "https://api.z.ai/api/monitor/usage/quota/limit");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-resolved");
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(headers.get("x-private-header"), null);
    assert.equal([...headers.keys()].sort().join(","), "accept,authorization");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return Response.json(zaiPayload);
  }, () => NOW);
  await tracker.refresh(ctx);
  await tracker.refresh(ctx);
  assert.equal(calls, 1);
  assert.equal(tracker.getText(), EXPECTED);
  tracker.stop();
});

test("unsupported providers, API keys and nonofficial origins do not resolve auth or fetch", async () => {
  const cases = [
    context("other"), context("anthropic", { oauth: false }), context("openai-codex-account-2"),
    context("xai", { oauth: false }),
    context("opencode-go", { oauth: true }),
    context("zai", { oauth: true }),
    ...["https://proxy.example", "http://chatgpt.com", "https://chatgpt.com:8443", "https://user@chatgpt.com", "not a URL"]
      .map((baseUrl) => context("openai-codex", { baseUrl })),
    ...["https://cli-chat-proxy.grok.com", "https://cli-chat-proxy.grok.com/v1", "http://api.x.ai/v1",
      "https://api.x.ai:8443", "https://user@api.x.ai/v1", "https://api.x.ai.example", "not a URL"]
      .map((baseUrl) => context("xai", { baseUrl })),
    ...["https://proxy.example", "http://opencode.ai", "https://opencode.ai:8443",
      "https://user@opencode.ai/zen/go/v1", "https://opencode.ai.example", "not a URL"]
      .map((baseUrl) => context("opencode-go", { oauth: false, baseUrl })),
    ...["https://proxy.example", "http://api.z.ai", "https://api.z.ai:8443",
      "https://user@api.z.ai/api/coding/paas/v4", "https://api.z.ai.example", "not a URL"]
      .map((baseUrl) => context("zai", { oauth: false, baseUrl })),
  ];
  const tracker = new SubscriptionUsageTracker(() => {}, async () => { throw new Error("unexpected fetch"); }, () => NOW);
  for (const { ctx, authCalls } of cases) {
    await tracker.refresh(ctx);
    assert.equal(authCalls(), 0);
    assert.equal(tracker.getText(), undefined);
  }
});

test("refreshes deduplicate and respect provider TTL even across model/provider selections", async () => {
  let now = NOW;
  let calls = 0;
  const tracker = new SubscriptionUsageTracker(() => {}, async (url) => {
    calls += 1;
    return Response.json(String(url).includes("anthropic") ? anthropicPayload : codexPayload);
  }, () => now);
  const codex = context().ctx;
  const anthropic = context("anthropic").ctx;
  await Promise.all([tracker.refresh(codex), tracker.refresh(codex)]);
  assert.equal(calls, 1);
  await tracker.refresh(anthropic);
  await tracker.refresh(codex);
  codex.model!.id = "another-model";
  await tracker.refresh(codex);
  assert.equal(calls, 2);
  now += 5 * MINUTE;
  await tracker.refresh(codex);
  await tracker.refresh(anthropic);
  assert.equal(calls, 3);
  now += 5 * MINUTE;
  await tracker.refresh(anthropic);
  assert.equal(calls, 4);
  tracker.stop();
});

test("an observed logout invalidates the previous account's quota before another login", async () => {
  let calls = 0;
  const tracker = new SubscriptionUsageTracker(() => {}, async () => {
    calls += 1;
    return Response.json({ five_hour: { utilization: calls === 1 ? 10 : 90 } });
  }, () => NOW);
  await tracker.refresh(context("anthropic", { apiKey: "test-account-a" }).ctx);
  assert.equal(tracker.getText(), "5h 90% left / reset unknown");
  await tracker.refresh(context("anthropic", { oauth: false }).ctx);
  assert.equal(tracker.getText(), undefined);
  await tracker.refresh(context("anthropic", { apiKey: "test-account-b" }).ctx);
  assert.equal(calls, 2);
  assert.equal(tracker.getText(), "5h 10% left / reset unknown");
  tracker.stop();
});

test("errors preserve labeled stale data and Retry-After backs off without automatic retries", async () => {
  let now = NOW;
  let calls = 0;
  const { ctx } = context();
  const tracker = new SubscriptionUsageTracker(() => {}, async () => {
    calls += 1;
    return calls === 1 ? Response.json(codexPayload) : new Response(null, { status: 429, headers: { "Retry-After": "3600" } });
  }, () => now);
  await tracker.refresh(ctx);
  now += 5 * MINUTE;
  await tracker.refresh(ctx);
  assert.match(tracker.getText()!, /\(stale\)$/);
  now += 59 * MINUTE;
  await tracker.refresh(ctx);
  assert.equal(calls, 2);
  now += MINUTE;
  await tracker.refresh(ctx);
  assert.equal(calls, 3);
  tracker.stop();
});

test("switching providers aborts old requests and late responses cannot replace current quota", async () => {
  const old = deferred<Response>();
  const started = deferred<void>();
  let oldSignal: AbortSignal | undefined;
  const tracker = new SubscriptionUsageTracker(() => {}, async (url, init) => {
    if (String(url).includes("chatgpt")) {
      oldSignal = init?.signal ?? undefined;
      started.resolve();
      return old.promise;
    }
    return Response.json({ five_hour: { utilization: 95 } });
  }, () => NOW);
  const pending = tracker.refresh(context().ctx);
  await started.promise;
  await tracker.refresh(context("anthropic").ctx);
  assert.equal(oldSignal?.aborted, true);
  assert.equal(tracker.getText(), "5h 5% left / reset unknown");
  old.resolve(Response.json(codexPayload));
  await pending;
  assert.equal(tracker.getText(), "5h 5% left / reset unknown");
  await tracker.refresh(context("other").ctx);
  assert.equal(tracker.getText(), undefined);
  tracker.stop();
});

test("shutdown cancels waiting authentication and prevents late fetches or updates", async () => {
  const auth = deferred<Awaited<ReturnType<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>>>();
  const { ctx } = context();
  ctx.modelRegistry.getApiKeyAndHeaders = () => auth.promise;
  let calls = 0;
  let updates = 0;
  const tracker = new SubscriptionUsageTracker(() => { updates += 1; }, async () => { calls += 1; return Response.json(codexPayload); }, () => NOW);
  const pending = tracker.refresh(ctx);
  tracker.stop();
  const before = updates;
  await pending;
  auth.resolve({ ok: true, apiKey: "test", headers: {} });
  await Promise.resolve();
  assert.equal(calls, 0);
  assert.equal(updates, before);
  assert.equal(tracker.getText(), undefined);
  tracker.stop();
});

test("a timed-out request clears busy state and backs off before retrying", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = NOW;
  let calls = 0;
  const { ctx } = context();
  const tracker = new SubscriptionUsageTracker(() => {}, async (_url, init) => {
    calls += 1;
    if (calls > 1) return Response.json(codexPayload);
    return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  }, () => now);
  const pending = tracker.refresh(ctx);
  // Drain auth resolution before firing the bounded fetch timeout.
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  t.mock.timers.tick(15_000);
  await pending;
  assert.equal(tracker.getText(), undefined);
  await tracker.refresh(ctx);
  assert.equal(calls, 1);
  now += 5 * MINUTE;
  await tracker.refresh(ctx);
  assert.equal(calls, 2);
  assert.equal(tracker.getText(), "5h 63% left / 2h 9m · 7d 72% left / 4d 2h");
  tracker.stop();
});
