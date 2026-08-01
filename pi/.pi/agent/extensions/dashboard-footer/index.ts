import { homedir } from "node:os";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { getCapabilities, hyperlink, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const POLL_INTERVAL_MS = 3_000;
const PR_REFRESH_INTERVAL_MS = 60_000;
const LIVE_UPDATE_INTERVAL_MS = 200;
const CHARS_PER_ESTIMATED_TOKEN = 4;
// The footer polls git constantly; --no-optional-locks keeps it from taking
// .git/index.lock and racing the user's own git commands in the same repo.
const GIT_READONLY = ["--no-optional-locks"];
// Extension statuses that would only add noise to the footer.
const HIDDEN_STATUS_KEYS = new Set(["pi-vimmode", "mcp"]);

// Terminal-controlled text such as paths and branch names must not be allowed
// to inject escape sequences into the TUI.
// eslint-disable-next-line no-control-regex
const OSC_PATTERN = /(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)/g;
// eslint-disable-next-line no-control-regex
const CSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const ESCAPE_PATTERN = /\u001b(?:[()][0-2A-Z]|[ -/]*[@-~])/g;

function sanitize(text: string) {
  return text
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_PATTERN, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function formatTokens(tokens: number) {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 100_000) return `${(tokens / 1_000).toFixed(1)}k`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

function formatDirectory(cwd: string) {
  const home = homedir();
  if (cwd === home) return "~";
  return sanitize(cwd.startsWith(`${home}/`) ? `~/${relative(home, cwd)}` : cwd);
}

function columns(left: string, right: string, width: number) {
  if (!right) return truncateToWidth(left, width);

  const naturalGap = width - visibleWidth(left) - visibleWidth(right);
  if (naturalGap >= 1) return `${left}${" ".repeat(naturalGap)}${right}`;

  const leftWidth = Math.max(1, Math.floor(width * 0.45));
  const rightWidth = Math.max(1, width - leftWidth - 1);
  const fittedLeft = truncateToWidth(left, leftWidth);
  const fittedRight = truncateToWidth(right, rightWidth);
  const gap = Math.max(1, width - visibleWidth(fittedLeft) - visibleWidth(fittedRight));
  return truncateToWidth(`${fittedLeft}${" ".repeat(gap)}${fittedRight}`, width);
}

function sessionCost(ctx: ExtensionContext) {
  let cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      cost += entry.message.usage.cost.total;
    }
  }
  return cost;
}

function estimateTokens(characters: number) {
  return Math.ceil(characters / CHARS_PER_ESTIMATED_TOKEN);
}

function safeHttpUrl(value: string) {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

interface GitState {
  branch: string | null;
  changedFiles: number;
  pullRequest: { number: number; url: string } | null;
}

export default function dashboardFooter(pi: ExtensionAPI) {
  let requestRender: (() => void) | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  const activeGitRefreshes = new Set<number>();
  let queriedPrBranch: string | null = null;
  let lastPrQueryAt = 0;
  let git: GitState = { branch: null, changedFiles: 0, pullRequest: null };
  let tokensPerSecond: number | null = null;

  let streamStartedAt: number | null = null;
  let lastDeltaAt: number | null = null;
  let streamedCharacters = 0;
  let firstDeltaCharacters = 0;
  let deltaCount = 0;
  let sawToolCall = false;
  let runTokens = 0;
  let runStreamMs = 0;
  let lastLiveUpdate = 0;

  function resetMessageTracking() {
    streamStartedAt = null;
    lastDeltaAt = null;
    streamedCharacters = 0;
    firstDeltaCharacters = 0;
    deltaCount = 0;
    sawToolCall = false;
    lastLiveUpdate = 0;
  }

  async function refreshGit(ctx: ExtensionContext, forcePullRequest = false) {
    const refreshGeneration = generation;
    if (activeGitRefreshes.has(refreshGeneration)) return;
    activeGitRefreshes.add(refreshGeneration);
    try {
      const repo = await pi.exec("git", [...GIT_READONLY, "rev-parse", "--is-inside-work-tree"], {
        cwd: ctx.cwd,
        timeout: 3_000,
      });
      if (refreshGeneration !== generation) return;
      if (repo.code !== 0 || repo.stdout.trim() !== "true") {
        queriedPrBranch = null;
        git = { branch: null, changedFiles: 0, pullRequest: null };
        requestRender?.();
        return;
      }

      const [branchResult, headResult, statusResult] = await Promise.all([
        pi.exec("git", [...GIT_READONLY, "branch", "--show-current"], { cwd: ctx.cwd, timeout: 3_000 }),
        pi.exec("git", [...GIT_READONLY, "rev-parse", "--short", "HEAD"], { cwd: ctx.cwd, timeout: 3_000 }),
        pi.exec("git", [...GIT_READONLY, "status", "--porcelain=v1", "--untracked-files=all"], {
          cwd: ctx.cwd,
          timeout: 3_000,
        }),
      ]);
      if (refreshGeneration !== generation) return;

      const branchName = sanitize(branchResult.stdout.trim());
      const shortHead = sanitize(headResult.stdout.trim());
      const branch = branchName || (shortHead ? `detached@${shortHead}` : "detached");
      const branchChanged = branchName !== queriedPrBranch;
      const changedFiles = statusResult.code === 0
        ? statusResult.stdout.split("\n").filter(Boolean).length
        : 0;

      git = {
        branch,
        changedFiles,
        pullRequest: branchChanged ? null : git.pullRequest,
      };
      requestRender?.();

      if (!branchName) {
        queriedPrBranch = null;
        return;
      }

      if (
        forcePullRequest ||
        branchChanged ||
        Date.now() - lastPrQueryAt >= PR_REFRESH_INTERVAL_MS
      ) {
        queriedPrBranch = branchName;
        lastPrQueryAt = Date.now();
        const result = await pi.exec(
          "gh",
          ["pr", "view", branchName, "--json", "number,url,state"],
          { cwd: ctx.cwd, timeout: 10_000 },
        ).catch(() => undefined);
        if (refreshGeneration !== generation) return;

        let pullRequest: GitState["pullRequest"] = null;
        if (result?.code === 0) {
          try {
            const value = JSON.parse(result.stdout) as {
              number?: unknown;
              url?: unknown;
              state?: unknown;
            };
            if (
              typeof value.number === "number" &&
              typeof value.url === "string" &&
              value.state === "OPEN"
            ) {
              const url = safeHttpUrl(value.url);
              if (url) pullRequest = { number: value.number, url };
            }
          } catch {
            // An unavailable or unexpected gh response simply hides PR info.
          }
        }
        if (refreshGeneration !== generation) return;
        git = { ...git, pullRequest };
        requestRender?.();
      }
    } catch {
      // Git information is optional; lifecycle cancellation and command failures
      // should never produce an unhandled rejection or break the footer.
    } finally {
      activeGitRefreshes.delete(refreshGeneration);
    }
  }

  function install(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;

    ctx.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
      requestRender = () => tui.requestRender();

      return {
        invalidate() {},
        render(width: number) {
          const usage = ctx.getContextUsage();
          const model = ctx.model;
          const contextPercent = usage?.percent === null || usage?.percent === undefined
            ? "?"
            : `${Math.round(usage.percent)}`;
          const contextWindow = usage?.contextWindow ?? model?.contextWindow;
          const contextTokens = usage?.tokens === null || usage?.tokens === undefined
            ? "?"
            : formatTokens(usage.tokens);
          const context =
            `${contextTokens} / ${contextWindow ? formatTokens(contextWindow) : "?"} (${contextPercent}%)`;
          const cost = `$${sessionCost(ctx).toFixed(2)}`;
          const speed = tokensPerSecond === null ? "— tok/s" : `${Math.round(tokensPerSecond)} tok/s`;
          const modelLabel = model
            ? `${sanitize(model.provider)}/${sanitize(model.id)} · ${model.reasoning ? pi.getThinkingLevel() : "off"}`
            : "no model";

          const fileLabel = git.changedFiles === 1 ? "file" : "files";
          let gitLabel = git.branch
            ? `${git.branch} · ${git.changedFiles} ${fileLabel} changed`
            : "";
          if (git.pullRequest) {
            const label = `PR #${git.pullRequest.number}`;
            const linked = getCapabilities().hyperlinks
              ? hyperlink(label, git.pullRequest.url)
              : label;
            gitLabel += ` · ${linked}`;
          }

          const lines = [
            columns(theme.fg("text", modelLabel), theme.fg("muted", formatDirectory(ctx.cwd)), width),
            columns(theme.fg("muted", `${context} · ${cost} · ${speed}`), theme.fg("muted", gitLabel), width),
          ];

          const statuses = footerData.getExtensionStatuses();
          for (const [key, text] of Array.from(statuses.entries()).sort(([a], [b]) => a.localeCompare(b))) {
            if (HIDDEN_STATUS_KEYS.has(key)) continue;
            for (const line of text.split("\n")) {
              lines.push(truncateToWidth(line, width, theme.fg("dim", "...")));
            }
          }

          // Render a materialized blank row so differential updates keep the
          // bottom spacing stable while the working indicator animates.
          lines.push(" ".repeat(width));
          return lines;
        },
      };
    });

    void refreshGit(ctx, true);
    pollTimer = setInterval(() => void refreshGit(ctx), POLL_INTERVAL_MS);
  }

  pi.on("session_start", (_event, ctx) => {
    generation += 1;
    if (pollTimer) clearInterval(pollTimer);
    git = { branch: null, changedFiles: 0, pullRequest: null };
    queriedPrBranch = null;
    lastPrQueryAt = 0;
    tokensPerSecond = null;
    runTokens = 0;
    runStreamMs = 0;
    resetMessageTracking();
    install(ctx);
  });

  pi.on("model_select", () => requestRender?.());

  pi.on("thinking_level_select", () => requestRender?.());

  pi.on("agent_start", () => {
    runTokens = 0;
    runStreamMs = 0;
    tokensPerSecond = null;
    resetMessageTracking();
    requestRender?.();
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") resetMessageTracking();
  });

  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") return;
    const streamEvent = event.assistantMessageEvent;
    if (streamEvent.type === "toolcall_delta") {
      sawToolCall = true;
      return;
    }
    if (streamEvent.type !== "text_delta" && streamEvent.type !== "thinking_delta") return;
    if (!streamEvent.delta) return;

    const now = Date.now();
    if (streamStartedAt === null) {
      streamStartedAt = now;
      firstDeltaCharacters = streamEvent.delta.length;
    }
    lastDeltaAt = now;
    streamedCharacters += streamEvent.delta.length;
    deltaCount += 1;

    const elapsedMs = now - streamStartedAt;
    const charactersAfterFirst = streamedCharacters - firstDeltaCharacters;
    if (
      deltaCount >= 2 &&
      elapsedMs > 0 &&
      charactersAfterFirst > 0 &&
      now - lastLiveUpdate >= LIVE_UPDATE_INTERVAL_MS
    ) {
      lastLiveUpdate = now;
      tokensPerSecond = estimateTokens(charactersAfterFirst) / (elapsedMs / 1_000);
      requestRender?.();
    }
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    sawToolCall ||= event.message.content.some((block) => block.type === "toolCall");

    if (streamStartedAt !== null && streamedCharacters > 0) {
      const streamMs = (lastDeltaAt ?? streamStartedAt) - streamStartedAt;
      const firstTokens = estimateTokens(firstDeltaCharacters);
      const streamedTokens = !sawToolCall && event.message.usage.output > 0
        ? Math.max(0, event.message.usage.output - firstTokens)
        : Math.max(0, estimateTokens(streamedCharacters) - firstTokens);
      if (deltaCount >= 2 && streamMs >= 50 && streamedTokens > 0) {
        runTokens += streamedTokens;
        runStreamMs += streamMs;
        tokensPerSecond = runTokens / (runStreamMs / 1_000);
      }
    }
    resetMessageTracking();
    requestRender?.();
  });

  pi.on("turn_end", () => requestRender?.());
  pi.on("agent_settled", () => requestRender?.());

  pi.on("input", (_event, ctx) => {
    void refreshGit(ctx);
    return { action: "continue" };
  });

  pi.on("tool_execution_end", (_event, ctx) => void refreshGit(ctx));

  pi.on("session_shutdown", (_event, ctx) => {
    generation += 1;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    requestRender = undefined;
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
  });
}
