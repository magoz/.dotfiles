import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Runtime = ReturnType<typeof import("./src/runtime.ts").createRuntime>;

// Background runners mark their process. Foreground SDK children instead carry
// pi-subagents' active_agent tag in their custom system prompt (0.68.x).
function isChild(ctx: ExtensionContext): boolean {
  return ctx.getSystemPrompt().trimStart().startsWith("<active_agent ");
}

export default function primaryAgent(pi: ExtensionAPI): void {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;

  let runtime: Promise<Runtime> | undefined;
  const load = () => (runtime ??= Promise.all([
    import("./src/runtime.ts"),
    import("@earendil-works/pi-coding-agent"),
  ]).then(([{ createRuntime }, { getAgentDir }]) => createRuntime(pi, getAgentDir())));

  pi.registerCommand("agent", {
    description: "Select a primary identity; /agent status or /agent clear (model unchanged)",
    handler: async (args, ctx) => {
      if (isChild(ctx)) return;
      await (await load()).command(args, ctx);
    },
  });

  // Required identity restoration only: small local config/prompt reads, no
  // discovery, provider probes, processes, or optional background setup.
  const restore = async (_event: unknown, ctx: ExtensionContext) => {
    if (isChild(ctx)) return;
    (await load()).restore(ctx);
  };
  // Pi 0.85 reports new/resume/fork/reload via session_start.reason.
  pi.on("session_start", restore);
  pi.on("session_tree", restore);

  pi.on("before_agent_start", async (event, ctx) => {
    if (isChild(ctx)) return;
    return (await load()).beforeStart(event.systemPrompt, ctx);
  });
}
