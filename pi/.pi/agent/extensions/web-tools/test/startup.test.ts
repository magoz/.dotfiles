import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("import and registration do not load HTML conversion dependencies", () => {
	const blocked = ["html-to-text", "linkedom", "turndown", "turndown-plugin-gfm"];
	const loader =
		"data:text/javascript," +
		encodeURIComponent(`
      const blocked = ${JSON.stringify(blocked)}
      export async function resolve(specifier, context, nextResolve) {
        if (blocked.includes(specifier)) {
          throw new Error("HTML dependency loaded during web-tools registration: " + specifier)
        }
        return nextResolve(specifier, context)
      }
    `);
	const extensionUrl = new URL("../index.ts", import.meta.url).href;
	const script = `
    const { default: register } = await import(${JSON.stringify(extensionUrl)})
    const names = []
    register({ registerTool(tool) { names.push(tool.name) } })
    if (names.join(",") !== "webfetch,websearch") {
      throw new Error("unexpected registered tools: " + names.join(","))
    }
  `;
	const result = spawnSync(
		process.execPath,
		[
			"--no-warnings",
			"--import",
			"tsx",
			"--experimental-loader",
			loader,
			"--input-type=module",
			"--eval",
			script,
		],
		{ encoding: "utf8" },
	);

	assert.equal(result.status, 0, result.stderr);
});

test("registered lazy tools delegate to their execution runtimes", async () => {
	const { default: register } = await import("../index.ts");
	const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
	register({
		registerTool(tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) {
			tools.set(tool.name, tool);
		},
	} as never);

	const webfetch = tools.get("webfetch");
	const websearch = tools.get("websearch");
	assert.ok(webfetch);
	assert.ok(websearch);
	await assert.rejects(
		webfetch.execute("fetch-test", { url: "https://user:secret@example.com" }),
		/URL credentials are not supported/,
	);
	await assert.rejects(
		websearch.execute("search-test", { query: "   " }),
		/Search query cannot be empty/,
	);
});
