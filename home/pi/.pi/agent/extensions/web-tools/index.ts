import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { webFetchToolDefinition } from "./webfetch-definition.ts";
import { webSearchToolDefinition } from "./websearch-definition.ts";

type WebFetchTool = ReturnType<typeof import("./webfetch.ts").createWebFetchTool>;
type WebSearchTool = ReturnType<typeof import("./websearch.ts").createWebSearchTool>;

export default function webToolsExtension(pi: ExtensionAPI) {
	let webFetchToolPromise: Promise<WebFetchTool> | undefined;
	let webSearchToolPromise: Promise<WebSearchTool> | undefined;

	const loadWebFetchTool = () =>
		(webFetchToolPromise ??= import("./webfetch.ts").then(({ createWebFetchTool }) => createWebFetchTool()));
	const loadWebSearchTool = () =>
		(webSearchToolPromise ??= import("./websearch.ts").then(({ createWebSearchTool }) => createWebSearchTool()));

	pi.registerTool({
		...webFetchToolDefinition,
		async execute(...args: Parameters<WebFetchTool["execute"]>) {
			return (await loadWebFetchTool()).execute(...args);
		},
	});

	pi.registerTool({
		...webSearchToolDefinition,
		async execute(...args: Parameters<WebSearchTool["execute"]>) {
			return (await loadWebSearchTool()).execute(...args);
		},
	});
}
