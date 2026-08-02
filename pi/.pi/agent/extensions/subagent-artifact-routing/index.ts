import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type SubagentInput = Record<string, unknown> & {
  action?: unknown;
  chain?: unknown;
  chainDir?: unknown;
};

export function defaultChainRunsDir(
  tempDir = tmpdir(),
  uid = typeof process.getuid === "function" ? process.getuid() : undefined,
): string {
  const scope = uid === undefined ? "user" : `uid-${uid}`;
  return join(tempDir, `pi-subagents-${scope}`, "chain-runs");
}

export function routeSubagentChainArtifacts(
  toolName: string,
  input: unknown,
  chainRunsDir = defaultChainRunsDir(),
): boolean {
  if (
    toolName !== "subagent" ||
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return false;
  }

  const params = input as SubagentInput;
  if (params.action !== undefined || !Array.isArray(params.chain)) {
    return false;
  }

  if (typeof params.chainDir === "string" && params.chainDir.trim() !== "") {
    return false;
  }

  params.chainDir = chainRunsDir;
  return true;
}

export default function subagentArtifactRouting(pi: ExtensionAPI): void {
  // artifactDir does not route chain scratch directories in pi-subagents 0.37–0.40.
  pi.on("tool_call", (event) => {
    routeSubagentChainArtifacts(event.toolName, event.input);
  });
}
