import * as NodeServices from "@effect/platform-node/NodeServices";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  currentTarget,
  liveBinaryEnv,
  repositoryBinDir,
  resolveBinary,
  TOOL_SPECS,
  type BinaryEnv,
  type BinarySource,
  type PlatformTarget,
  type ResolvedBinary,
} from "./binaries.ts";
import type { CapturedOutput } from "./output.ts";
import { discardCapturedOutput, executeSearchProcess } from "./process.ts";

const EXEC_TIMEOUT_MS = 60_000;

type ToolName = "fd" | "rg";

export interface SearchOutcome {
  readonly output: CapturedOutput;
  readonly noMatches: boolean;
  readonly binarySource: BinarySource;
}

export interface SearchRuntime {
  runSearch(
    tool: ToolName,
    args: string[],
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<SearchOutcome>;
}

function cacheDetached<A, E>(effect: Effect.Effect<A, E>) {
  let promise: Promise<Exit.Exit<A, E>> | undefined;
  return Effect.suspend(() =>
    Effect.promise(
      () => (promise ??= Effect.runPromiseExit(effect)),
    ).pipe(
      Effect.flatMap((exit) =>
        Exit.isSuccess(exit)
          ? Effect.succeed(exit.value)
          : Effect.failCause(exit.cause),
      ),
    ),
  );
}

export function makeBinaryInitializers(
  binDir: string,
  target: PlatformTarget,
  env: BinaryEnv,
) {
  return {
    // Resolution continues independently if the search that triggered it is
    // cancelled, so a caller interruption cannot become the cached result.
    fd: cacheDetached(resolveBinary(TOOL_SPECS.fd, binDir, target, env)),
    rg: cacheDetached(resolveBinary(TOOL_SPECS.rg, binDir, target, env)),
  };
}

/** Human-readable install notice, shown only for fresh downloads. */
export function installNotifications(binaries: readonly ResolvedBinary[]) {
  return binaries
    .filter((binary) => binary.source === "installed")
    .map(
      (binary) =>
        `file-search: no system ${binary.tool} found — downloaded ${binary.tool} ${binary.version ?? ""}`.trimEnd() +
        ` to ${repositoryBinDir()}`,
    );
}

class SearchError extends Data.TaggedError("SearchError")<{
  readonly message: string;
}> {}

function causeMessage<E>(cause: Cause.Cause<E>) {
  const [first] = Cause.prettyErrors(cause);
  return first?.message ?? Cause.pretty(cause);
}

function unwrapToolExit<A, E>(exit: Exit.Exit<A, E>, tool: ToolName) {
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) {
    throw new Error(`${tool} search was cancelled.`);
  }
  throw new Error(causeMessage(exit.cause));
}

export function createSearchRuntime(): SearchRuntime {
  const initializers = makeBinaryInitializers(
    repositoryBinDir(),
    currentTarget(),
    liveBinaryEnv,
  );
  const notified = { fd: false, rg: false };

  function notifySetupFailure(
    tool: ToolName,
    cause: Cause.Cause<unknown>,
    ctx: ExtensionContext,
  ) {
    if (!ctx.hasUI || notified[tool]) return;
    notified[tool] = true;
    ctx.ui.notify(
      `file-search ${tool} setup failed: ${causeMessage(cause)}`,
      "error",
    );
  }

  function notifyInstall(binary: ResolvedBinary, ctx: ExtensionContext) {
    if (!ctx.hasUI || notified[binary.tool]) return;
    notified[binary.tool] = true;
    for (const message of installNotifications([binary])) {
      ctx.ui.notify(message, "info");
    }
  }

  /** Resolve the binary lazily, stream its output, and classify its exit. */
  function runSearchEffect(
    tool: ToolName,
    args: string[],
    ctx: ExtensionContext,
  ) {
    return Effect.gen(function* () {
      const binaryExit = yield* Effect.exit(initializers[tool]);
      if (Exit.isFailure(binaryExit)) {
        if (!Cause.hasInterruptsOnly(binaryExit.cause)) {
          notifySetupFailure(tool, binaryExit.cause, ctx);
        }
        return yield* Effect.failCause(binaryExit.cause);
      }

      const binary = binaryExit.value;
      notifyInstall(binary, ctx);
      const result = yield* executeSearchProcess({
        command: binary.command,
        args,
        cwd: ctx.cwd,
        tempPrefix: `pi-${tool}-`,
      });

      // ripgrep exits 1 for "no matches"; fd exits 0 even with no results.
      if (tool === "rg" && result.code === 1 && result.output.lineCount === 0) {
        return {
          output: result.output,
          noMatches: true,
          binarySource: binary.source,
        } satisfies SearchOutcome;
      }
      if (result.code !== 0) {
        yield* discardCapturedOutput(result.output);
        const detail = result.stderr.trim() || `exit code ${result.code}`;
        return yield* new SearchError({ message: `${tool} failed: ${detail}` });
      }
      return {
        output: result.output,
        noMatches: result.output.lineCount === 0,
        binarySource: binary.source,
      } satisfies SearchOutcome;
    }).pipe(
      Effect.timeout(EXEC_TIMEOUT_MS),
      Effect.mapError((error) => {
        if (error instanceof SearchError) return error;
        return new SearchError({
          message:
            error._tag === "TimeoutError"
              ? `${tool} timed out.`
              : error instanceof Error
                ? error.message
                : String(error),
        });
      }),
      Effect.provide(NodeServices.layer),
    );
  }

  return {
    async runSearch(tool, args, ctx, signal) {
      const exit = await Effect.runPromiseExit(
        runSearchEffect(tool, args, ctx),
        signal ? { signal } : undefined,
      );
      return unwrapToolExit(exit, tool);
    },
  };
}
