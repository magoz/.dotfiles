import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import register, {
  buildAgentRequest,
  buildArgs,
  inferBranch,
  parseCommand,
} from "./index.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "worktree-spec-")));
const repo = join(scratch, "repo");
mkdirSync(repo);

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("worktree extension", () => {
  it("builds argv without shell interpolation", () => {
    expect(
      buildArgs(
        {
          branch: "feat/reporting",
          base: "origin/main",
          path: "/tmp/path with spaces",
          label: "reporting",
          ttl: "3d",
          prompt: "Implement reports; do not interpolate this",
          setup: ["pnpm db:push"],
        },
        "/repo with spaces",
      ),
    ).toEqual([
      "create",
      "--repo",
      "/repo with spaces",
      "--branch",
      "feat/reporting",
      "--base",
      "origin/main",
      "--path",
      "/tmp/path with spaces",
      "--label",
      "reporting",
      "--ttl",
      "3d",
      "--prompt",
      "Implement reports; do not interpolate this",
      "--setup",
      "pnpm db:push",
    ]);
  });

  it("keeps default creation on the CLI's fresh-base path and explains override intent", () => {
    for (const input of [{ prompt: "Add exports" }, { branch: "feat/exports" }]) {
      expect(buildArgs(input, "/repo")).not.toContain("--base");
      expect(buildAgentRequest(input)).toContain("omit base to fetch origin's current default branch");
      expect(buildAgentRequest(input)).toContain("A destination branch name alone is not a base override");
    }
    let tool: any;
    register({ registerCommand() {}, registerTool(value: unknown) { tool = value; } } as never);
    expect(tool.promptGuidelines.join(" ")).toContain("Never bypass a failed fetch");
  });

  it("leaves the default checkout path to the CLI's sibling policy", () => {
    for (const input of [{ prompt: "Add exports" }, { branch: "feat/exports" }]) {
      expect(buildArgs(input, "/repo")).not.toContain("--path");
      expect(buildAgentRequest(input)).toContain(
        "omit path unless the user explicitly requests an exact custom checkout path",
      );
      expect(buildAgentRequest(input)).toContain("beside the primary repository");
      expect(buildAgentRequest(input)).toContain(
        "Do not choose a centralized worktree root on the user's behalf",
      );
    }

    let tool: any;
    register({ registerCommand() {}, registerTool(value: unknown) { tool = value; } } as never);
    expect(tool.promptGuidelines.join(" ")).toContain(
      "omit path unless the user explicitly requests an exact custom checkout path",
    );
    expect(tool.parameters.properties.path.description).toContain(
      "explicitly requested by the user",
    );
  });

  it("infers a conventional branch when the slash command contains only a task", () => {
    expect(parseCommand("Add reporting exports")).toEqual({ prompt: "Add reporting exports" });
    expect(inferBranch("Add reporting exports")).toBe("feat/reporting-exports");
    expect(inferBranch("Fix the broken payment date validation")).toBe(
      "fix/broken-payment-date-validation",
    );
  });

  it("preserves explicit branch syntax", () => {
    expect(parseCommand("feat/reporting Add reporting exports")).toEqual({
      branch: "feat/reporting",
      prompt: "Add reporting exports",
    });
    expect(parseCommand("--branch custom-name Add reporting exports")).toEqual({
      branch: "custom-name",
      prompt: "Add reporting exports",
    });
  });

  it("routes slash-command tasks through the agent so it can infer or ask", async () => {
    let command: any;
    const sendUserMessage = vi.fn();
    register({
      registerCommand(name: string, value: unknown) {
        if (name === "worktree") command = value;
      },
      registerTool() {},
      sendUserMessage,
    } as never);

    await command.handler("Add reporting exports", {
      waitForIdle: vi.fn(),
      ui: { input: vi.fn() },
    });

    expect(sendUserMessage).toHaveBeenCalledWith(
      buildAgentRequest({ prompt: "Add reporting exports" }),
    );
    expect(sendUserMessage.mock.calls[0]?.[0]).toContain("ask me before calling the tool");
  });

  it("registers synchronously without running external commands", () => {
    const commands: string[] = [];
    const tools: string[] = [];
    register({
      registerCommand(name: string) {
        commands.push(name);
      },
      registerTool(tool: { name: string }) {
        tools.push(tool.name);
      },
    } as never);

    expect(commands).toEqual(["worktree", "worktrees"]);
    expect(tools).toEqual(["create_worktree"]);
  });

  it("derives a branch inside the tool when the agent omits it", async () => {
    vi.stubEnv("HERDR_ENV", "1");
    let tool: any;
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: "ready", stderr: "" });
    register({
      registerCommand() {},
      registerTool(value: unknown) {
        tool = value;
      },
      exec,
    } as never);

    await tool.execute(
      "call-derived",
      { prompt: "Add reporting exports" },
      new AbortController().signal,
      undefined,
      { cwd: repo, shutdown: vi.fn() },
    );

    expect(exec.mock.calls[1]?.[1]).toContain("feat/reporting-exports");
  });

  it("starts the shared CLI and shuts down only after success", async () => {
    vi.stubEnv("HERDR_ENV", "1");
    let tool: any;
    const exec = vi.fn().mockResolvedValue({
      code: 0,
      stdout: "worktree: ready\n  workspace: w1\n",
      stderr: "",
    });
    register({
      registerCommand() {},
      registerTool(value: unknown) {
        tool = value;
      },
      exec,
    } as never);

    const shutdown = vi.fn();
    const result = await tool.execute(
      "call-1",
      { branch: "feat/reporting", prompt: "Implement reports" },
      new AbortController().signal,
      undefined,
      { cwd: repo, shutdown },
    );

    expect(exec).toHaveBeenCalledWith(
      "worktree",
      [
        "create",
        "--repo",
        repo,
        "--branch",
        "feat/reporting",
        "--prompt",
        "Implement reports",
      ],
      expect.objectContaining({ timeout: 30 * 60 * 1_000 }),
    );
    expect(shutdown).toHaveBeenCalledOnce();
    expect(result.terminate).toBe(true);
  });

  it("returns agent recovery before allocation and retries the same request after linking", async () => {
    vi.stubEnv("HERDR_ENV", "1");
    let tool: any;
    const exec = vi.fn()
      .mockResolvedValueOnce({ code: 3, stdout: "", stderr: JSON.stringify({
        status: "vercel_link_required", directory: "/repo/apps/web", reason: "no Vercel project link found",
      }) })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "ready", stderr: "" });
    register({
      registerCommand() {},
      registerTool(value: unknown) { tool = value; },
      exec,
    } as never);
    const input = { branch: "feat/reporting", prompt: "Implement reports", ttl: "3d", setup: ["pnpm db:push"] };
    const shutdown = vi.fn();
    const ctx = { cwd: repo, shutdown };
    const signal = new AbortController().signal;
    const result = await tool.execute("preflight", input, signal, undefined, ctx);
    expect(exec).toHaveBeenCalledExactlyOnceWith("provision-env", [
      "--repo", repo, "--check-vercel-link", "--non-interactive",
    ], { signal, timeout: 30_000, cwd: repo });
    expect(shutdown).not.toHaveBeenCalled();
    expect(result.terminate).toBeUndefined();
    expect(result.details).toEqual({
      status: "vercel_link_required", directory: "/repo/apps/web",
      reason: "no Vercel project link found", retry: input,
    });
    expect(result.content[0].text).toContain("without asking for permission");
    expect(result.content[0].text).toContain("authentication/access");
    expect(result.content[0].text).toContain("No worktree or Herdr workspace was created");
    expect(tool.promptGuidelines.join(" ")).toContain("current Pi agent");

    const retried = await tool.execute("retry", result.details.retry, signal, undefined, ctx);
    expect(exec.mock.calls.map(([command]) => command)).toEqual(["provision-env", "provision-env", "worktree"]);
    expect(exec.mock.calls[2]?.[1]).toEqual(buildArgs(input, repo));
    expect(retried.terminate).toBe(true);
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it.each([
    { code: 3, stdout: "", stderr: "not JSON" },
    { code: 3, stdout: "", stderr: '{"status":"vercel_link_required","directory":null,"reason":"missing"}' },
    { code: 2, stdout: "", stderr: '{"status":"vercel_link_required","directory":"/repo","reason":"missing"}' },
    { code: 0, killed: true, stdout: "", stderr: "timeout" },
  ])("does not treat unknown or killed preflight results as permission to recover: %j", async (preflight) => {
    vi.stubEnv("HERDR_ENV", "1");
    let tool: any;
    const exec = vi.fn().mockResolvedValue(preflight);
    register({ registerCommand() {}, registerTool(value: unknown) { tool = value; }, exec } as never);
    const shutdown = vi.fn();
    await expect(tool.execute("call", { branch: "feat/test" }, undefined, undefined, { cwd: repo, shutdown }))
      .rejects.toThrow("preflight failed");
    expect(exec).toHaveBeenCalledOnce();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("cancellation after preflight never creates a worktree", async () => {
    vi.stubEnv("HERDR_ENV", "1");
    let tool: any;
    const controller = new AbortController();
    const exec = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { code: 0, stdout: "", stderr: "" };
    });
    register({ registerCommand() {}, registerTool(value: unknown) { tool = value; }, exec } as never);
    const shutdown = vi.fn();
    await expect(tool.execute("call", { branch: "feat/test" }, controller.signal, undefined, { cwd: repo, shutdown }))
      .rejects.toThrow();
    expect(exec).toHaveBeenCalledOnce();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("creates from the primary checkout when this session's worktree was already removed", async () => {
    vi.stubEnv("HERDR_ENV", "1");
    const primary = join(scratch, "app");
    mkdirSync(join(primary, ".git"), { recursive: true });
    const removed = join(scratch, "app-fix-merged-work");
    let tool: any;
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: "ready", stderr: "" });
    register({ registerCommand() {}, registerTool(value: unknown) { tool = value; }, exec } as never);
    const onUpdate = vi.fn();
    const shutdown = vi.fn();
    const signal = new AbortController().signal;

    const result = await tool.execute(
      "after-merge",
      { branch: "fix/next-thing", prompt: "Next task" },
      signal,
      onUpdate,
      { cwd: removed, shutdown },
    );

    expect(exec).toHaveBeenNthCalledWith(1, "provision-env", [
      "--repo", primary, "--check-vercel-link", "--non-interactive",
    ], { signal, timeout: 30_000, cwd: primary });
    expect(exec).toHaveBeenNthCalledWith(
      2,
      "worktree",
      buildArgs({ branch: "fix/next-thing", prompt: "Next task" }, primary),
      expect.objectContaining({ cwd: primary }),
    );
    expect(onUpdate.mock.calls[0]?.[0].content[0].text).toContain(`using primary checkout ${primary}`);
    expect(result.content[0].text).toContain(`${removed} no longer exists`);
    expect(result.details.sourceRepo).toBe(primary);
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it("explains a missing session directory without running commands when no primary is found", async () => {
    vi.stubEnv("HERDR_ENV", "1");
    let tool: any;
    const exec = vi.fn();
    register({ registerCommand() {}, registerTool(value: unknown) { tool = value; }, exec } as never);
    const shutdown = vi.fn();

    await expect(tool.execute(
      "orphan",
      { branch: "fix/next-thing" },
      undefined,
      undefined,
      { cwd: join(scratch, "nothing-matches", "here"), shutdown },
    )).rejects.toThrow("Start Pi in the primary checkout");
    expect(exec).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("keeps the source Pi alive when creation fails after a successful preflight", async () => {
    vi.stubEnv("HERDR_ENV", "1");
    let tool: any;
    register({
      registerCommand() {},
      registerTool(value: unknown) {
        tool = value;
      },
      exec: vi.fn()
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 2, stdout: "", stderr: "provisioning failed" }),
    } as never);

    const shutdown = vi.fn();
    await expect(
      tool.execute(
        "call-1",
        { branch: "feat/reporting" },
        new AbortController().signal,
        undefined,
        { cwd: repo, shutdown },
      ),
    ).rejects.toThrow("provisioning failed");
    expect(shutdown).not.toHaveBeenCalled();
  });
});
