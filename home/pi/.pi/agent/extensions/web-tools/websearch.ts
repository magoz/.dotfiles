import { createOperationSignal, isOperationTimeoutError } from "./network.ts";
import { FetchHttpTextClient, ExaSearchProvider } from "./providers/exa.ts";
import type { SearchProvider } from "./providers/types.ts";
import { SearchWeb, type SearchWebError } from "./search-web.ts";
import { getWebToolsSettings, type ToolInputParseError } from "./settings.ts";
import {
	TempFileToolOutputStore,
	formatSearchResults,
	projectSearchWebResultToPiToolResult,
	type PiToolResult,
	type ToolOutputStore,
	type ToolOutputStoreError,
	type WebSearchDetails,
} from "./tool-output.ts";
import type { ParseSearchQueryError, WebToolsSettings } from "./types.ts";
import { webSearchToolDefinition } from "./websearch-definition.ts";
import { parseWebSearchToolParams } from "./websearch-input.ts";

export { formatSearchResults };

export interface WebSearchToolComposition {
	readonly settings: WebToolsSettings;
	readonly searchWeb: SearchWeb;
	readonly outputStore: ToolOutputStore;
}

type WebSearchBoundaryError = ToolInputParseError | ParseSearchQueryError | SearchWebError | ToolOutputStoreError;

export function createWebSearchTool(composition?: WebSearchToolComposition) {
	return {
		...webSearchToolDefinition,

		async execute(
			_toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
			onUpdate?: (update: PiToolResult<WebSearchDetails>) => void,
		) {
			const actualComposition = composition ?? createDefaultWebSearchComposition();
			const parsed = parseWebSearchToolParams(params, actualComposition.settings.search);
			if (parsed._tag === "err") {
				throw toWebSearchToolError(parsed.error);
			}

			const composed = createOperationSignal(parsed.value.timeoutSeconds * 1000, signal);
			onUpdate?.({
				content: [textContent(`Searching for ${JSON.stringify(parsed.value.query)}...`)],
				details: {
					query: parsed.value.query,
					depth: parsed.value.depth,
					maxResults: parsed.value.maxResults,
					provider: actualComposition.settings.search.provider,
					resultCount: 0,
					results: [],
				},
			});

			try {
				const result = await actualComposition.searchWeb.search(
					{
						query: parsed.value.query,
						maxResults: parsed.value.maxResults,
						depth: parsed.value.depth,
					},
					{ signal: composed.signal },
				);
				if (result._tag === "err") {
					throw toWebSearchBoundaryError(result.error, parsed.value.timeoutSeconds, signal, composed.signal);
				}

				const projected = await projectSearchWebResultToPiToolResult(result.value, actualComposition.outputStore);
				if (projected._tag === "err") {
					throw toWebSearchBoundaryError(projected.error, parsed.value.timeoutSeconds, signal, composed.signal);
				}

				return projected.value;
			} finally {
				composed.cleanup();
			}
		},
	};
}

export function toWebSearchToolError(error: WebSearchBoundaryError): Error {
	return new Error(renderSafeWebSearchError(error));
}

function createDefaultWebSearchComposition(): WebSearchToolComposition {
	const settings = getWebToolsSettings();
	const provider = createSearchProvider(settings.search);
	return {
		settings,
		searchWeb: new SearchWeb({ provider, settings: settings.search }),
		outputStore: new TempFileToolOutputStore(),
	};
}

function createSearchProvider(settings: WebToolsSettings["search"]): SearchProvider {
	switch (settings.provider) {
		case "exa":
			return new ExaSearchProvider(settings.endpoint, new FetchHttpTextClient());
	}
}

function toWebSearchBoundaryError(
	error: WebSearchBoundaryError,
	timeoutSeconds: number,
	outerSignal: AbortSignal | undefined,
	operationSignal: AbortSignal,
): Error {
	if (outerSignal?.aborted) {
		return new Error("Web search cancelled");
	}
	if (isOperationTimeoutError(operationSignal.reason)) {
		return new Error(`Web search timed out after ${timeoutSeconds}s`);
	}
	return toWebSearchToolError(error);
}

function renderSafeWebSearchError(error: WebSearchBoundaryError): string {
	switch (error._tag) {
		case "InvalidToolInput":
			return error.message;
		case "InvalidToolField":
			return `${error.field}: ${error.message}`;
		case "UnknownToolField":
			return `Unknown websearch field: ${error.field}`;
		case "EmptySearchQuery":
			return "Search query cannot be empty";
		case "SearchDisabled":
			return "websearch is disabled in web-tools settings. Enable it to use this tool.";
		case "SearchProviderUnavailable":
			return "Search provider unavailable";
		case "SearchProviderStatusRejected":
			return `Search request failed (${error.status})`;
		case "SearchProviderResponseTooLarge":
			return `Search response too large (${Math.floor(error.maxBytes / (1024 * 1024))}MB limit)`;
		case "SearchProviderProtocolInvalid":
			return "Search provider returned an invalid response";
		case "SearchProviderReturnedError":
			return error.safeMessage;
		case "SearchProviderNoRecognizedResults":
			return "Search provider returned an unrecognized response format";
		case "SearchProviderCancelled":
			return "Web search cancelled";
		case "TempFileWriteFailed":
			return "Failed to write full websearch output";
	}
}

function textContent(text: string) {
	return { type: "text" as const, text };
}
