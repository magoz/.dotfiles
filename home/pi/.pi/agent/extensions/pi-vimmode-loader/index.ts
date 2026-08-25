import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RUNTIME_ASSETS = ["package.json", "release-notes.json"] as const;

type RuntimeModule = {
  default(pi: ExtensionAPI): unknown;
};

type LoaderDependencies = {
  resolveEntry(): string;
  cacheRoot: string;
  loadRuntime(specifier: string): Promise<RuntimeModule>;
};

function hasExpectedContent(path: string, content: Buffer): boolean {
  try {
    const metadata = lstatSync(path);
    return metadata.isFile() && !metadata.isSymbolicLink() && readFileSync(path).equals(content);
  } catch {
    return false;
  }
}

function writeVerified(path: string, content: Buffer): void {
  if (hasExpectedContent(path, content)) return;
  rmSync(path, { force: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { flag: "wx", mode: 0o600 });
    try {
      renameSync(temporaryPath, path);
    } catch (error) {
      if (!hasExpectedContent(path, content)) throw error;
    }
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  if (!hasExpectedContent(path, content)) {
    throw new Error(`Failed to materialize verified pi-vimmode runtime file: ${path}`);
  }
}

/**
 * Give Pi/Jiti a TypeScript entrypoint so host-package aliases are applied.
 * The published JavaScript otherwise loads another copy of Pi's SDK natively.
 */
export function materializeTypeScriptRuntime(entryPath: string, cacheRoot: string): string {
  const packageDirectory = dirname(entryPath);
  const source = readFileSync(entryPath);
  const assets = RUNTIME_ASSETS.flatMap((name) => {
    const path = join(packageDirectory, name);
    return existsSync(path) ? [{ name, content: readFileSync(path) }] : [];
  });
  const digest = createHash("sha256");
  digest.update(source);
  for (const asset of assets) {
    digest.update(asset.name);
    digest.update(asset.content);
  }

  const runtimeDirectory = join(cacheRoot, digest.digest("hex").slice(0, 20));
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  const runtimePath = join(runtimeDirectory, "index.ts");
  writeVerified(runtimePath, source);
  for (const asset of assets) writeVerified(join(runtimeDirectory, asset.name), asset.content);
  return runtimePath;
}

function defaultDependencies(): LoaderDependencies {
  const packageRequire = createRequire(join(getAgentDir(), "npm", "package.json"));
  return {
    resolveEntry: () => packageRequire.resolve("pi-vimmode"),
    cacheRoot: join(homedir(), ".cache", "pi-vimmode-loader"),
    loadRuntime: (specifier) => import(specifier) as Promise<RuntimeModule>,
  };
}

export function createVimModeLoader(dependencies: LoaderDependencies = defaultDependencies()) {
  return async function piVimModeLoader(pi: ExtensionAPI): Promise<void> {
    const entryPath = dependencies.resolveEntry();
    const runtimePath = materializeTypeScriptRuntime(entryPath, dependencies.cacheRoot);
    const runtime = await dependencies.loadRuntime(pathToFileURL(runtimePath).href);
    await runtime.default(pi);
  };
}

export default createVimModeLoader();
