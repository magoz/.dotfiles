import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, loadInstructions, type Config, type Definition } from "./config.ts";

export const STATE_TYPE = "primary-agent:selection";
const STATUS_KEY = "primary-agent";

function modelGuide(definition: Definition): string {
  return definition.models.map(({ id, guidance }) => `- ${id}${guidance ? `: ${guidance}` : ""}`).join("\n");
}

export function createRuntime(pi: ExtensionAPI, agentDir: string) {
  const configPath = join(agentDir, "primary-agents.json");
  let config: Config = { default: null, agents: {} };
  let name: string | null = null;
  let definition: Definition | undefined;
  let instructions: string | undefined;
  let error: string | undefined;
  let notified: string | undefined;
  let initialized = false;

  function status(ctx: ExtensionContext) {
    ctx.ui.setStatus(STATUS_KEY, error ? `agent:${name ?? "error"} (!)` : name ? `agent:${name}` : undefined);
  }

  function save() {
    // Explicit null is a durable clear, not an invitation to reapply default.
    pi.appendEntry(STATE_TYPE, { version: 1, name });
  }

  function activate(selected: string | null) {
    const next = selected === null ? undefined : config.agents[selected];
    if (selected !== null && !next) throw new Error(`Primary agent "${selected}" is not configured`);
    const text = next ? loadInstructions(next) : undefined;
    name = selected;
    definition = next;
    instructions = text;
    error = undefined;
    notified = undefined;
  }

  function restore(ctx: ExtensionContext) {
    initialized = true;
    name = null;
    definition = undefined;
    instructions = undefined;
    error = undefined;
    notified = undefined;
    try {
      const entry = ctx.sessionManager.getBranch().reverse().find(
        (entry) => entry.type === "custom" && entry.customType === STATE_TYPE,
      );
      const saved = entry?.type === "custom";
      if (saved) {
        const data = entry.data as { version?: unknown; name?: unknown } | null;
        if (!data || data.version !== 1 || !(data.name === null || typeof data.name === "string")) {
          throw new Error("Unsupported primary-agent selection state; use /agent clear or select an identity");
        }
        name = data.name;
      }
      // A cleared identity must stay usable even while its config is broken.
      if (saved && name === null) {
        activate(null);
        status(ctx);
        return;
      }
      config = loadConfig(configPath);
      if (!saved) name = config.default;
      activate(name);
      // Pin the default, including 'none', on this branch. Future config edits
      // must not unexpectedly change a resumed session's identity.
      if (!saved) save();
    } catch (cause) {
      error = `${configPath}: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
    status(ctx);
  }

  function inspect(ctx: ExtensionContext) {
    const lines = [
      `Primary agent: ${name ?? "none"}`,
      "Model, thinking level, tools, and conversation are managed by Pi, not this identity.",
      `Config: ${configPath}`,
    ];
    if (error) lines.push(error);
    if (definition) lines.push(
      definition.description,
      `Prompt: ${definition.prompt}`,
      `Configured workers: ${definition.workers.join(", ") || "(discover with pi-subagents)"}`,
      `Model selection guide:\n${modelGuide(definition) || "(choose through pi-subagents)"}`,
      "Roster entries are preferences, not proof of availability or authentication.",
    );
    ctx.ui.notify(lines.filter(Boolean).join("\n"), error ? "warning" : "info");
  }

  async function command(args: string, ctx: ExtensionContext) {
    if (!initialized) restore(ctx);
    let selected = args.trim();
    if (selected === "status") return inspect(ctx);
    if (!ctx.isIdle()) {
      ctx.ui.notify("Wait until the agent is idle before changing its identity.", "warning");
      return;
    }
    try {
      // Clear remains available even if the configuration or prompt is broken.
      if (selected !== "clear") config = loadConfig(configPath);
      if (!selected) {
        if (!ctx.hasUI) return inspect(ctx);
        const sessionId = ctx.sessionManager.getSessionId();
        const leafId = ctx.sessionManager.getLeafId();
        const choices = Object.entries(config.agents).map(([key, value]) => ({
          name: key,
          label: `${key}${key === name ? " (active)" : ""}${value.description ? ` — ${value.description}` : ""}`,
        }));
        choices.push({ name: "clear", label: "(none) — clear primary identity" });
        const choice = await ctx.ui.select("Primary agent (current model stays unchanged)", choices.map((item) => item.label));
        if (choice === undefined) return;
        if (!ctx.isIdle() || sessionId !== ctx.sessionManager.getSessionId() || leafId !== ctx.sessionManager.getLeafId()) {
          ctx.ui.notify("Session changed while selecting; run /agent again.", "warning");
          return;
        }
        selected = choices.find((item) => item.label === choice)?.name ?? "";
      }
      activate(selected === "clear" ? null : selected);
      save();
      status(ctx);
      ctx.ui.notify(name ? `Primary agent: ${name}. Model unchanged.` : "Primary identity cleared. Model unchanged.", "info");
    } catch (cause) {
      // Failed activation leaves the previous working identity intact.
      ctx.ui.notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  }

  function beforeStart(systemPrompt: string, ctx: ExtensionContext) {
    if (!initialized) restore(ctx);
    if (error) {
      if (notified !== error) {
        ctx.ui.notify(error, "warning");
        notified = error;
      }
      return {
        systemPrompt: `${systemPrompt}\n\nPrimary-agent configuration is unavailable. Tell the user to inspect /agent status and fix the configuration or use /agent clear; do not silently assume another primary identity.`,
      };
    }
    if (!name || !definition || !instructions) return;
    const roster = [
      definition.workers.length ? `Preferred worker agents: ${definition.workers.join(", ")}.` : "",
      definition.models.length ? `Model selection guide:\n${modelGuide(definition)}` : "",
      "These are configured preferences, not a live capability or authentication check. Use pi-subagents' current discovery and guidance before delegation; do not assume a listed agent or model is executable. Other discovered workers and models may be used when appropriate, consistent with the selection guidance and user constraints.",
    ].filter(Boolean).join("\n");
    const availability = pi.getActiveTools().includes("subagent") ? "" :
      "\nThe subagent tool is not active. Report this if delegation is needed; do not substitute a CLI or another execution engine.";
    return {
      systemPrompt: `${systemPrompt}\n\n<primary_agent name="${name}">\nThis identity applies only to the main assistant, not workers. Preserve all repository, task, and tool constraints.\n\n${instructions}\n\n${roster}${availability}\n</primary_agent>`,
    };
  }

  return { restore, command, beforeStart };
}
