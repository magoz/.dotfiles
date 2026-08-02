import assert from "node:assert/strict";
import test from "node:test";
import register, {
  defaultChainRunsDir,
  routeSubagentChainArtifacts,
} from "./index.ts";

test("uses pi-subagents' user-scoped temp chain directory", () => {
  assert.equal(
    defaultChainRunsDir("/tmp", 501),
    "/tmp/pi-subagents-uid-501/chain-runs",
  );
});

test("adds chainDir to chain executions", () => {
  const input: {
    chain: Array<{ agent: string; task: string }>;
    chainDir?: string;
  } = {
    chain: [{ agent: "scout", task: "inspect" }],
  };

  assert.equal(
    routeSubagentChainArtifacts("subagent", input, "/tmp/chain-runs"),
    true,
  );
  assert.equal(input.chainDir, "/tmp/chain-runs");
});

test("replaces an empty chainDir", () => {
  const input = {
    chain: [{ agent: "scout", task: "inspect" }],
    chainDir: "  ",
  };

  routeSubagentChainArtifacts("subagent", input, "/tmp/chain-runs");

  assert.equal(input.chainDir, "/tmp/chain-runs");
});

test("preserves an explicit chainDir", () => {
  const input = {
    chain: [{ agent: "scout", task: "inspect" }],
    chainDir: "/requested/output",
  };

  assert.equal(
    routeSubagentChainArtifacts("subagent", input, "/tmp/chain-runs"),
    false,
  );
  assert.equal(input.chainDir, "/requested/output");
});

test("does not change non-chain or management calls", () => {
  const single = { agent: "scout", task: "inspect" };
  const append = {
    action: "append-step",
    chain: [{ agent: "reviewer", task: "review" }],
  };

  assert.equal(
    routeSubagentChainArtifacts("subagent", single, "/tmp/chain-runs"),
    false,
  );
  assert.equal(
    routeSubagentChainArtifacts("subagent", append, "/tmp/chain-runs"),
    false,
  );
  assert.equal(
    routeSubagentChainArtifacts("other", {}, "/tmp/chain-runs"),
    false,
  );
});

test("registers a tool_call interceptor", () => {
  let handler: ((event: { toolName: string; input: unknown }) => void) | undefined;
  register({
    on(name: string, candidate: typeof handler) {
      assert.equal(name, "tool_call");
      handler = candidate;
    },
  } as never);

  assert.ok(handler);
  const input: { chain: Array<{ agent: string }>; chainDir?: string } = {
    chain: [{ agent: "scout" }],
  };
  handler({ toolName: "subagent", input });
  assert.equal(input.chainDir, defaultChainRunsDir());
});
