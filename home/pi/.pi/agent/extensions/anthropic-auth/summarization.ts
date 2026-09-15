// Adapted from gotgenes/pi-anthropic-auth v2.0.9 (MIT).
export const SUMMARIZATION_PROMPT_ANCHOR =
	"You are a context summarization assistant.";
const ENVELOPE_OPEN = "<conversation>";
const ENVELOPE_CLOSE = "</conversation>";
const THINKING_MARKER = "[Assistant thinking]: ";
const TRANSCRIPT_BOUNDARY =
	/\n\n(?=\[(?:User|Assistant thinking|Assistant|Assistant tool calls|Tool result)\]: )/;

/** Strip reasoning prose from Pi's single conversation envelope, not its format instructions. */
export function stripTranscribedThinking(text: string): string {
	const open = text.indexOf(ENVELOPE_OPEN);
	if (open === -1) return text;
	const start = open + ENVELOPE_OPEN.length;
	const end = text.indexOf(ENVELOPE_CLOSE, start);
	if (end === -1) return text;

	// Keep framing newlines; blank lines inside reasoning are not segment boundaries.
	const body = text.slice(start, end);
	const [, leading = "", transcript = "", trailing = ""] =
		/^(\n*)([\s\S]*?)(\n*)$/.exec(body) ?? [];
	const segments = transcript.split(TRANSCRIPT_BOUNDARY);
	const kept = segments.filter((segment) => !segment.startsWith(THINKING_MARKER));
	if (kept.length === segments.length) return text;

	return text.slice(0, start) + leading + kept.join("\n\n") + trailing + text.slice(end);
}
