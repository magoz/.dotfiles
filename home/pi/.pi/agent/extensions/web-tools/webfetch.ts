import { FetchPage, type FetchPageError } from "./fetch-page.ts";
import { createOperationSignal, FetchPublicWebClient, isOperationTimeoutError } from "./network.ts";
import { getWebToolsSettings, type ToolInputParseError } from "./settings.ts";
import {
	TempFileToolOutputStore,
	projectFetchPageResultToPiToolResult,
	type PiToolResult,
	type ToolOutputStore,
	type ToolOutputStoreError,
	type WebFetchDetails,
} from "./tool-output.ts";
import type { ParsePublicHttpUrlError, WebToolsSettings } from "./types.ts";
import { webFetchToolDefinition } from "./webfetch-definition.ts";
import { parseWebFetchToolParams } from "./webfetch-input.ts";

export {
	OPENCODE_WEBFETCH_DEFAULT_USER_AGENT,
	OPENCODE_WEBFETCH_FALLBACK_USER_AGENT,
	createWebFetchHeaders,
	getFallbackUserAgent,
	shouldRetryWithFallbackUserAgent,
} from "./fetch-page.ts";

export interface WebFetchToolComposition {
	readonly settings: WebToolsSettings;
	readonly fetchPage: FetchPage;
	readonly outputStore: ToolOutputStore;
}

type WebFetchBoundaryError = ToolInputParseError | ParsePublicHttpUrlError | FetchPageError | ToolOutputStoreError;

export function createWebFetchTool(composition?: WebFetchToolComposition) {
	return {
		...webFetchToolDefinition,

		async execute(
			_toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
			onUpdate?: (update: PiToolResult<WebFetchDetails>) => void,
		) {
			const actualComposition = composition ?? createDefaultWebFetchComposition();
			const parsed = parseWebFetchToolParams(params, actualComposition.settings.fetch);
			if (parsed._tag === "err") {
				throw toWebFetchToolError(parsed.error);
			}

			const composed = createOperationSignal(parsed.value.timeoutSeconds * 1000, signal);
			onUpdate?.({
				content: [textContent(`Fetching ${parsed.value.url}...`)],
				details: {
					requestedUrl: parsed.value.url,
					finalUrl: parsed.value.url,
					format: parsed.value.format,
					status: 0,
					mime: "",
					contentType: "",
					bytes: 0,
				},
			});

			try {
				const result = await actualComposition.fetchPage.fetch(
					{ url: parsed.value.url, format: parsed.value.format },
					{ signal: composed.signal },
				);
				if (result._tag === "err") {
					throw toWebFetchBoundaryError(result.error, parsed.value.timeoutSeconds, signal, composed.signal);
				}

				const projected = await projectFetchPageResultToPiToolResult(result.value, actualComposition.outputStore);
				if (projected._tag === "err") {
					throw toWebFetchBoundaryError(projected.error, parsed.value.timeoutSeconds, signal, composed.signal);
				}

				return projected.value;
			} finally {
				composed.cleanup();
			}
		},
	};
}

export function toWebFetchToolError(error: WebFetchBoundaryError): Error {
	return new Error(renderSafeWebFetchError(error));
}

function createDefaultWebFetchComposition(): WebFetchToolComposition {
	const settings = getWebToolsSettings();
	return {
		settings,
		fetchPage: new FetchPage({ publicWeb: new FetchPublicWebClient(), settings: settings.fetch }),
		outputStore: new TempFileToolOutputStore(),
	};
}

function toWebFetchBoundaryError(
	error: WebFetchBoundaryError,
	timeoutSeconds: number,
	outerSignal: AbortSignal | undefined,
	operationSignal: AbortSignal,
): Error {
	if (outerSignal?.aborted) {
		return new Error("Web fetch cancelled");
	}
	if (isOperationTimeoutError(operationSignal.reason)) {
		return new Error(`Web fetch timed out after ${timeoutSeconds}s`);
	}
	return toWebFetchToolError(error);
}

function renderSafeWebFetchError(error: WebFetchBoundaryError): string {
	switch (error._tag) {
		case "InvalidToolInput":
			return error.message;
		case "InvalidToolField":
			return `${error.field}: ${error.message}`;
		case "UnknownToolField":
			return `Unknown webfetch field: ${error.field}`;
		case "EmptyUrl":
			return "URL cannot be empty";
		case "UnsupportedUrlProtocol":
			return "URL must start with http:// or https://";
		case "InvalidUrl":
			return "Invalid URL";
		case "UrlCredentialsUnsupported":
			return "URL credentials are not supported";
		case "PublicWebRequestFailed":
			return "Request failed";
		case "PublicWebCancelled":
			return "Web fetch cancelled";
		case "PublicWebTimedOut":
			return `Web fetch timed out after ${error.timeoutSeconds}s`;
		case "PrivateHostBlocked":
			return "Blocked private or local host";
		case "PrivateIpBlocked":
			return "Blocked private or local IP address";
		case "RedirectLocationMissing":
			return "Redirect response was missing a Location header";
		case "RedirectLocationInvalid":
			return "Redirect response had an invalid Location header";
		case "RedirectLimitExceeded":
			return "Too many redirects while fetching URL";
		case "RedirectProtocolUnsupported":
			return "Redirected to unsupported protocol";
		case "HttpStatusRejected":
			return `Request failed (${error.status} ${error.statusText || ""})`.trim();
		case "ResponseTooLarge":
			return `Response too large (${Math.floor(error.maxBytes / (1024 * 1024))}MB limit)`;
		case "UnsupportedBinaryContent":
			return `Unsupported binary content${error.mime ? ` (${error.mime})` : ""}. Try a more text-oriented URL.`;
		case "HtmlConversionFailed":
			return "HTML conversion failed";
		case "TempFileWriteFailed":
			return "Failed to write full webfetch output";
	}
}

function textContent(text: string) {
	return { type: "text" as const, text };
}
