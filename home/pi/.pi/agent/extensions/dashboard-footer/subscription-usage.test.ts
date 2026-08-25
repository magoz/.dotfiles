import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSubscriptionUsage,
  normalizeAnthropicUsage,
  normalizeCodexUsage,
} from "./subscription-usage.ts";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");

test("formats Anthropic remaining quota and reset time for the 5h and 7d windows", () => {
  const windows = normalizeAnthropicUsage({
    five_hour: {
      utilization: 37,
      resets_at: "2026-08-11T14:14:00.000Z",
    },
    seven_day: {
      utilization: 28,
      resets_at: "2026-08-15T15:00:00.000Z",
    },
  });

  assert.equal(
    formatSubscriptionUsage(windows, NOW),
    "63% / 2h 14m (5h) · 72% / 4d 3h (7d)",
  );
});

test("formats Codex remaining quota and reset time for the 5h and 7d windows", () => {
  const windows = normalizeCodexUsage({
    rate_limit: {
      primary_window: {
        used_percent: 37,
        limit_window_seconds: 18_000,
        reset_at: (NOW + (2 * 60 + 14) * 60_000) / 1_000,
      },
      secondary_window: {
        used_percent: 28,
        limit_window_seconds: 604_800,
        reset_at: (NOW + (4 * 24 + 3) * 60 * 60_000) / 1_000,
      },
    },
  });

  assert.equal(
    formatSubscriptionUsage(windows, NOW),
    "63% / 2h 14m (5h) · 72% / 4d 3h (7d)",
  );
});
