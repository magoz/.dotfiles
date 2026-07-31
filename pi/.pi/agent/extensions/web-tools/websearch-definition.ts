import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { appendExpandHint, appendExpandedPreview, getTextContent } from "./render.ts";
import { SEARCH_DEPTHS } from "./settings.ts";
import type { WebSearchDetails } from "./tool-output.ts";
import type { SearchDepth } from "./types.ts";

interface RenderTheme {
	fg(name: string, value: string): string;
	bold(value: string): string;
}

/** Lightweight registration metadata and rendering for the websearch tool. */
export const webSearchToolDefinition = {
	name: "websearch" as const,
	label: "Web Search",
	description: "Search the public web for current information and candidate URLs to inspect with webfetch.",
	promptSnippet: "Search the public web for current information and relevant URLs",
	promptGuidelines: [
		"Use websearch when the user needs current public-web information or when the right URL is not yet known.",
		"After picking a promising result, use webfetch on that URL for deeper inspection.",
	],
	parameters: Type.Object({
		query: Type.String({ description: "Search query." }),
		maxResults: Type.Optional(
			Type.Number({
				description: "Maximum number of results to return. Overrides the web-tools search default max results setting.",
			}),
		),
		depth: Type.Optional(
			StringEnum([...SEARCH_DEPTHS], {
				description:
					"Search depth. Overrides the web-tools search default depth setting. 'deep' is accepted as a compatibility alias and mapped to 'fast' for the current Exa provider.",
			}),
		),
	}),

	renderCall(args: { query: string; depth?: SearchDepth; maxResults?: number }, theme: RenderTheme) {
		let text = theme.fg("toolTitle", theme.bold("websearch "));
		text += theme.fg("accent", JSON.stringify(String(args.query)));
		if (args.depth && args.depth !== "auto") {
			text += theme.fg("muted", ` (${args.depth})`);
		}
		if (args.maxResults) {
			text += theme.fg("dim", ` limit=${args.maxResults}`);
		}
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: WebSearchDetails; isError?: boolean },
		options: { expanded: boolean; isPartial: boolean },
		theme: RenderTheme,
	) {
		if (options.isPartial) {
			return new Text(theme.fg("warning", "Searching..."), 0, 0);
		}
		if (result.isError) {
			return new Text(theme.fg("error", `✗ ${getTextContent(result.content) || "Search failed"}`), 0, 0);
		}

		const details = result.details;
		let text = theme.fg("success", `✓ ${details?.resultCount ?? 0} results`);
		if (details?.provider) {
			text += theme.fg("muted", ` (${details.provider})`);
		}
		if (details?.truncated) {
			text += theme.fg("warning", " [truncated]");
		}
		text = appendExpandHint(text, options.expanded);

		if (options.expanded) {
			text = appendExpandedPreview(text, getTextContent(result.content), theme, { maxLines: 16, maxColumns: 220 });
			if (details?.fullOutputPath) {
				text += `\n${theme.fg("dim", `Full output: ${details.fullOutputPath}`)}`;
			}
		}

		return new Text(text, 0, 0);
	},
};
