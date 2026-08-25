import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createVimModeLoader, materializeTypeScriptRuntime } from "./index.ts";

test("materializes immutable TypeScript runtime files by source content", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-vimmode-loader-test-"));
  const sourcePath = join(root, "index.js");
  const cacheRoot = join(root, "cache");
  writeFileSync(sourcePath, "export default () => 'first';\n");
  writeFileSync(join(root, "package.json"), '{"version":"1.0.0"}\n');
  writeFileSync(join(root, "release-notes.json"), '{"version":"1.0.0","content":"notes"}\n');

  const firstPath = materializeTypeScriptRuntime(sourcePath, cacheRoot);
  const repeatedPath = materializeTypeScriptRuntime(sourcePath, cacheRoot);
  assert.equal(repeatedPath, firstPath);
  assert.match(firstPath, /index\.ts$/);
  assert.equal(readFileSync(firstPath, "utf8"), "export default () => 'first';\n");
  writeFileSync(firstPath, "corrupt cache");
  assert.equal(materializeTypeScriptRuntime(sourcePath, cacheRoot), firstPath);
  assert.equal(readFileSync(firstPath, "utf8"), "export default () => 'first';\n");
  assert.equal(readFileSync(join(firstPath, "..", "package.json"), "utf8"), '{"version":"1.0.0"}\n');
  assert.equal(
    readFileSync(join(firstPath, "..", "release-notes.json"), "utf8"),
    '{"version":"1.0.0","content":"notes"}\n',
  );

  writeFileSync(sourcePath, "export default () => 'second';\n");
  const changedPath = materializeTypeScriptRuntime(sourcePath, cacheRoot);
  assert.notEqual(changedPath, firstPath);
  assert.equal(readFileSync(changedPath, "utf8"), "export default () => 'second';\n");
});

test("delegates registration to the materialized runtime", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-vimmode-loader-test-"));
  const sourcePath = join(root, "index.js");
  const cacheRoot = join(root, "cache");
  writeFileSync(sourcePath, "runtime source");
  const pi = { marker: "same instance" };
  let loadedUrl = "";
  let delegatedPi: unknown;

  const loader = createVimModeLoader({
    resolveEntry: () => sourcePath,
    cacheRoot,
    loadRuntime: async (url) => {
      loadedUrl = url;
      return {
        default(receivedPi: unknown) {
          delegatedPi = receivedPi;
        },
      };
    },
  });

  await loader(pi as never);
  assert.match(loadedUrl, /^file:.*\/index\.ts$/);
  assert.equal(delegatedPi, pi);
});
