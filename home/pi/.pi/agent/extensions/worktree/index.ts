import type {
  ExecOptions,
  ExecResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { WorktreeActionService } from "./manager-actions.ts";
import { runWorktreeManager } from "./manager-command.ts";
import { WorktreeManagerService, type ManagerCommandRunner } from "./manager-service.ts";

const WorktreeInput = Type.Object({
  branch: Type.Optional(
    Type.String({
      description: "Exact branch name; omit to derive a conventional branch from the kickoff prompt",
    }),
  ),
  base: Type.Optional(
    Type.String({ description: "Base ref; defaults to the repository default branch" }),
  ),
  path: Type.Optional(Type.String({ description: "Explicit checkout path" })),
  label: Type.Optional(Type.String({ description: "Herdr, database, and Pi session label" })),
  ttl: Type.Optional(Type.String({ description: "Sandbox database lifetime, default 7d" })),
  prompt: Type.Optional(Type.String({ description: "Kickoff prompt for the new Pi session" })),
  setup: Type.Optional(
    Type.Array(Type.String(), {
      description: "Explicit repository setup commands to run after provisioning",
    }),
  ),
});

export type WorktreeInput = Static<typeof WorktreeInput>;
export type ResolvedWorktreeInput = Omit<WorktreeInput, "branch"> & { branch: string };

const BRANCH_PREFIXES = new Set(["feat", "fix", "chore", "docs", "refactor", "test", "issue"]);

function taskSlug(prompt: string): string {
  const normalized = prompt
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^(?:please\s+)?(?:create|start|make|open)\s+(?:a\s+)?(?:new\s+)?worktree\s+(?:to|for)\s+/i, "")
    .replace(/^(?:add|build|create|fix|implement|repair)\s+(?:a\s+|an\s+|the\s+)?/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52)
    .replace(/-+$/g, "");
  if (!normalized) throw new Error("Cannot derive a branch name from an empty task");
  return normalized;
}

export function inferBranch(prompt: string): string {
  const task = prompt.trim();
  const prefix = /\b(fix|bug|broken|error|repair|regression)\b/i.test(task) ? "fix" : "feat";
  return `${prefix}/${taskSlug(task)}`;
}

export function resolveInput(input: WorktreeInput): ResolvedWorktreeInput {
  const branch = input.branch?.trim() || (input.prompt?.trim() ? inferBranch(input.prompt) : "");
  if (!branch) {
    throw new Error("Provide a branch name or a kickoff prompt from which to derive one");
  }
  return { ...input, branch };
}

export function buildArgs(input: WorktreeInput, cwd: string): string[] {
  const resolved = resolveInput(input);
  const args = ["create", "--repo", cwd, "--branch", resolved.branch];
  if (resolved.base) args.push("--base", resolved.base);
  if (resolved.path) args.push("--path", resolved.path);
  if (resolved.label) args.push("--label", resolved.label);
  if (resolved.ttl) args.push("--ttl", resolved.ttl);
  if (resolved.prompt) args.push("--prompt", resolved.prompt);
  for (const command of resolved.setup ?? []) args.push("--setup", command);
  return args;
}

function requireHerdr(): void {
  if (process.env.HERDR_ENV !== "1") {
    throw new Error("Worktree handoff requires this Pi session to run inside Herdr");
  }
}

async function launch(
  pi: ExtensionAPI,
  input: WorktreeInput,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<string> {
  requireHerdr();
  const result = await pi.exec("worktree", buildArgs(input, ctx.cwd), {
    signal,
    timeout: 30 * 60 * 1_000,
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    throw new Error(`worktree failed: ${detail}`);
  }
  return result.stdout.trim();
}

export function parseCommand(input: string): WorktreeInput {
  const value = input.trim();
  if (!value) throw new Error("Describe the work or pass --branch <name>");

  const named = /^--branch(?:=|\s+)(\S+)(?:\s+([\s\S]+))?$/.exec(value);
  if (named?.[1]) {
    return {
      branch: named[1],
      ...(named[2]?.trim() ? { prompt: named[2].trim() } : {}),
    };
  }

  const legacy = /^(\S+\/\S+)(?:\s+([\s\S]+))?$/.exec(value);
  if (legacy?.[1] && BRANCH_PREFIXES.has(legacy[1].split("/", 1)[0]!)) {
    return {
      branch: legacy[1],
      ...(legacy[2]?.trim() ? { prompt: legacy[2].trim() } : {}),
    };
  }

  return { prompt: value };
}

export function buildAgentRequest(input: WorktreeInput): string {
  if (input.branch) {
    const task = input.prompt?.trim();
    return [
      "Create a new worktree using the create_worktree tool.",
      `Use the exact branch name: ${input.branch}`,
      task ? `Kickoff task for the destination Pi: ${task}` : undefined,
      "Ask me before calling the tool if any other consequential setup detail is ambiguous.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Create a new worktree using the create_worktree tool for the task below.",
    "Infer a concise conventional branch name from the task.",
    "If the appropriate branch name or worktree intent is genuinely ambiguous, ask me before calling the tool.",
    `Task: ${input.prompt}`,
  ].join("\n");
}

async function runCommand(pi: ExtensionAPI, input: string, ctx: ExtensionCommandContext) {
  await ctx.waitForIdle();
  let request = input.trim();
  if (!request) {
    request = (await ctx.ui.input("New worktree", "Describe the work to start"))?.trim() ?? "";
    if (!request) return;
  }
  pi.sendUserMessage(buildAgentRequest(parseCommand(request)));
}

export default function worktreeExtension(pi: ExtensionAPI): void {
  const commandRunner: ManagerCommandRunner = {
    run(command: string, args: ReadonlyArray<string>, options?: ExecOptions): Promise<ExecResult> {
      return pi.exec(command, [...args], options);
    },
  };
  const inventory = new WorktreeManagerService(commandRunner);
  const actions = new WorktreeActionService(commandRunner);

  pi.registerCommand("worktree", {
    description: "Create a provisioned Herdr worktree; branch name is optional",
    handler: (input, ctx) => runCommand(pi, input, ctx),
  });

  pi.registerCommand("worktrees", {
    description: "Manage Git, Herdr, Pi, environment, and database worktree state",
    handler: async (_input, ctx) => {
      await ctx.waitForIdle();
      await runWorktreeManager(ctx, {
        inventory,
        actions,
        requestCreate(task) {
          pi.sendUserMessage(buildAgentRequest({ prompt: task }));
        },
      });
    },
  });

  pi.registerTool({
    name: "create_worktree",
    label: "Create worktree",
    description:
      "Create a Git worktree and Herdr workspace, provision its environment and database, " +
      "start a fresh Pi there, and shut down this Pi after successful handoff.",
    promptSnippet: "Create and provision a Herdr worktree, then hand off to a fresh Pi session",
    promptGuidelines: [
      "Use create_worktree only when the user explicitly asks to start work in a new worktree; " +
        "infer a concise conventional branch when omitted, ask the user first when the choice is genuinely " +
        "ambiguous, and remember that a successful call terminates the current Pi session.",
    ],
    parameters: WorktreeInput,
    async execute(_toolCallId, input, signal, onUpdate, ctx) {
      const resolved = resolveInput(input);
      onUpdate?.({
        content: [{ type: "text", text: `Creating and provisioning ${resolved.branch}…` }],
        details: {},
      });
      const output = await launch(pi, resolved, ctx, signal);
      ctx.shutdown();
      return {
        content: [
          {
            type: "text",
            text: "Destination Pi launched successfully; shutting down this source session.",
          },
        ],
        details: { output },
        terminate: true,
      };
    },
  });
}
