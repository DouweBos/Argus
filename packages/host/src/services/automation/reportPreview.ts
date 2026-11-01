import type { AutomationRun } from "./models";

/** Long enough for a two-line list row, short enough to keep run lists cheap. */
export const REPORT_PREVIEW_MAX_CHARS = 160;

/** One line of what a report says, for a row that links to the full one. Null without a report. */
export function reportPreview(
  run: Pick<AutomationRun, "report_blocks" | "report_markdown">,
): string | null {
  for (const block of run.report_blocks ?? []) {
    if (block.type === "heading") {
      return truncate(block.text);
    }
    if (block.type === "markdown") {
      const line = firstLine(block.text);
      if (line) {
        return truncate(line);
      }
    }
  }
  const line = firstLine(run.report_markdown ?? "");

  return line ? truncate(line) : null;
}

function firstLine(markdown: string): string {
  return (
    markdown
      .split("\n")
      .map((l) => l.replace(/^[#>\-*\s]+/, "").trim())
      .find((l) => l.length > 0) ?? ""
  );
}

function truncate(text: string): string {
  const trimmed = text.trim();

  return trimmed.length > REPORT_PREVIEW_MAX_CHARS
    ? `${trimmed.slice(0, REPORT_PREVIEW_MAX_CHARS - 1).trimEnd()}…`
    : trimmed;
}
