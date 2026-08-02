// herdr-pi-subagents-status.ts
//
// Surfaces pi-subagents async activity to Herdr while the orchestrator's turn
// is over and the pane would otherwise show "idle"/"done".
//
// Herdr's pi integration (herdr-agent-state.ts) is the sole lifecycle
// authority for this pane, and herdr's docs say sibling hooks must use
// display metadata, never `pane.report-agent`. So this extension:
//
//   1. Tracks pi-subagents async runs via its public events
//      (`subagent:async-started` / `subagent:async-complete`).
//   2. While runs are active, relabels the pane's idle/done state with
//      `herdr pane report-metadata --state-label` (display-only, TTL-guarded)
//      so the sidebar shows e.g. "⏳ 2 subagents (reviewer, worker)".
//   3. When a child reports needs_attention, emits the integration's
//      sanctioned `herdr:blocked` event so the pane rolls up as blocked
//      until the parent agent wakes or the run completes.
//
// Known limitation: after /reload or /resume the in-memory run map is empty,
// so a label is not restored for runs started before the reload. The TTL
// guarantees no stale label outlives its reporter.
//
// @ts-nocheck

import { execFile } from "node:child_process";

const HERDR_ENV = process.env.HERDR_ENV;
const paneId = process.env.HERDR_PANE_ID;
const herdrBin = process.env.HERDR_BIN || "herdr";

const SOURCE = "user:pi-subagents";
const TTL_MS = 120_000;
const REFRESH_MS = 45_000;

const ASYNC_STARTED = "subagent:async-started";
const ASYNC_COMPLETE = "subagent:async-complete";
const CONTROL_EVENT = "subagent:control-event";

function enabled() {
  return HERDR_ENV === "1" && !!paneId;
}

function herdr(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const child = execFile(herdrBin, args, { timeout: 5000 }, () => resolve());
      child.on("error", () => resolve());
    } catch {
      resolve();
    }
  });
}

export default function (pi) {
  if (!enabled()) {
    return;
  }

  type Run = { agent?: string; pid?: number };
  const runs = new Map<string, Run>();
  const raisedAttention = new Set<string>();

  // Only the root interactive session may publish. Headless pi-subagents
  // children inherit HERDR_PANE_ID and load this same extension; they must
  // stay silent or they would fight the parent over pane metadata.
  let rootSession = false;

  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let publishing = false;
  let dirty = false;
  let published = false;

  function label(): string {
    const agents = [...new Set([...runs.values()].map((r) => r.agent).filter(Boolean))];
    const who = agents.length
      ? ` (${agents.slice(0, 3).join(", ")}${agents.length > 3 ? ", …" : ""})`
      : "";
    return `⏳ ${runs.size} subagent${runs.size === 1 ? "" : "s"}${who}`;
  }

  function reconcile() {
    for (const [id, run] of runs) {
      if (typeof run.pid !== "number") continue;
      try {
        process.kill(run.pid, 0);
      } catch {
        runs.delete(id);
      }
    }
  }

  async function publishNow() {
    if (runs.size > 0) {
      const text = label();
      published = true;
      await herdr([
        "pane", "report-metadata", paneId,
        "--source", SOURCE,
        "--agent", "pi",
        "--state-label", `idle=${text}`,
        "--state-label", `done=${text}`,
        "--token", `summary=${text}`,
        "--ttl-ms", String(TTL_MS),
      ]);
    } else if (published) {
      published = false;
      await herdr([
        "pane", "report-metadata", paneId,
        "--source", SOURCE,
        "--agent", "pi",
        "--clear-state-labels",
        "--clear-token", "summary",
      ]);
    }
  }

  function publish() {
    if (!rootSession) return;
    if (publishing) {
      dirty = true;
      return;
    }
    publishing = true;
    void (async () => {
      try {
        do {
          dirty = false;
          await publishNow();
        } while (dirty);
      } finally {
        publishing = false;
      }
    })();
  }

  function syncTimer() {
    if (runs.size > 0 && !refreshTimer) {
      refreshTimer = setInterval(() => {
        reconcile();
        publish();
        syncTimer();
      }, REFRESH_MS);
      refreshTimer.unref?.();
    } else if (runs.size === 0 && refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
  }

  function clearAttention() {
    for (const _ of raisedAttention) {
      pi.events.emit("herdr:blocked", { active: false });
    }
    raisedAttention.clear();
  }

  pi.events.on(ASYNC_STARTED, (data) => {
    const id = data?.id;
    if (typeof id !== "string" || id.length === 0) return;
    runs.set(id, { agent: data?.agent, pid: data?.pid });
    publish();
    syncTimer();
  });

  pi.events.on(ASYNC_COMPLETE, (data) => {
    const id = data?.runId ?? data?.id;
    if (typeof id !== "string" || !runs.delete(id)) return;
    clearAttention();
    publish();
    syncTimer();
  });

  pi.events.on(CONTROL_EVENT, (data) => {
    if (!rootSession) return;
    if (data?.event?.type !== "needs_attention") return;
    const key = typeof data?.asyncDir === "string" ? data.asyncDir : "any";
    if (raisedAttention.has(key)) return;
    raisedAttention.add(key);
    pi.events.emit("herdr:blocked", {
      active: true,
      label: typeof data?.noticeText === "string" ? data.noticeText : "subagent needs attention",
    });
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx?.hasUI === true) {
      rootSession = true;
    }
  });

  // The parent waking up (result injection, user input) means attention is
  // being handled; release any blocked overlay we raised.
  pi.on("agent_start", () => {
    clearAttention();
  });

  pi.on("session_shutdown", async () => {
    if (!rootSession) return;
    clearAttention();
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    runs.clear();
    if (published) {
      published = false;
      await herdr([
        "pane", "report-metadata", paneId,
        "--source", SOURCE,
        "--agent", "pi",
        "--clear-state-labels",
        "--clear-token", "summary",
      ]);
    }
  });
}
