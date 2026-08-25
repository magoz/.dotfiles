import { formatSize } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { appendExpandHint, appendExpandedPreview, getTextContent } from "./render.ts";
import { WEB_FETCH_FORMATS } from "./settings.ts";
import type { WebFetchDetails } from "./tool-output.ts";
import { redactUrlCredentialsForDisplay, type WebFetchFormat } from "./types.ts";

interface RenderTheme {
	fg(name: string, value: string): string;
	bold(value: string): string;
}

/** Lightweight registration metadata and rendering for the webfetch tool. */
export const webFetchToolDefinition = {
	name: "webfetch" as const,
	label: "Web Fetch",
	description: "Fetch a single URL and return readable markdown, text, raw HTML/source, or an inline raster image.",
	promptSnippet: "Fetch one public URL as markdown, text, html, or an inline raster image",
	promptGuidelines: [
		"Use webfetch when the user provides a URL or after websearch identifies a page to inspect.",
		"Prefer webfetch format=markdown unless the user explicitly wants plain text or raw source.",
	],
	parameters: Type.Object({
		url: Type.String({ description: "The http:// or https:// URL to fetch." }),
		format: Type.Optional(
			StringEnum([...WEB_FETCH_FORMATS], {
				description: "Return format. Defaults to the web-tools fetch default format setting.",
			}),
		),
		timeout: Type.Optional(
			Type.Number({
				description: "Optional timeout in seconds. Overrides the web-tools fetch timeout setting.",
			}),
		),
	}),

	renderCall(args: { url: string; format?: WebFetchFormat }, theme: RenderTheme) {
		let text = theme.fg("toolTitle", theme.bold("webfetch "));
		text += theme.fg("accent", redactUrlCredentialsForDisplay(args.url));
		if (args.format && args.format !== "markdown") {
			text += theme.fg("muted", ` (${args.format})`);
		}
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: WebFetchDetails; isError?: boolean },
		options: { expanded: boolean; isPartial: boolean },
		theme: RenderTheme,
	) {
		if (options.isPartial) {
			return new Text(theme.fg("warning", "Fetching..."), 0, 0);
		}
		if (result.isError) {
			return new Text(theme.fg("error", `✗ ${getTextContent(result.content) || "Fetch failed"}`), 0, 0);
		}

		const details = result.details;
		let text = theme.fg("success", "✓ Fetched");
		if (details?.mime) {
			text += theme.fg("muted", ` (${details.mime})`);
		}
		if (details?.bytes) {
			text += theme.fg("dim", ` ${formatSize(details.bytes)}`);
		}
		if (details?.truncated) {
			text += theme.fg("warning", " [truncated]");
		}
		if (details?.image) {
			text += theme.fg("muted", " [image]");
		}
		text = appendExpandHint(text, options.expanded);

		if (options.expanded) {
			if (details?.image) {
				text += `\n${theme.fg("dim", `Image URL: ${details.finalUrl}`)}`;
			} else {
				text = appendExpandedPreview(text, getTextContent(result.content), theme, { maxLines: 12, maxColumns: 220 });
			}
			if (details?.fullOutputPath) {
				text += `\n${theme.fg("dim", `Full output: ${details.fullOutputPath}`)}`;
			}
		}

		return new Text(text, 0, 0);
	},
};
