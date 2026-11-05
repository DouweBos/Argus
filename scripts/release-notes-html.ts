/**
 * Render release notes Markdown (from `extract-release-notes.ts`) as an HTML
 * fragment for Sparkle: `generate_appcast` embeds an `.html` named like the
 * archive into that update's description, which its update window shows.
 *
 * Usage: tsx scripts/release-notes-html.ts <notes.md> <out.html>
 */

import { marked } from "marked";
import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  throw new Error("usage: release-notes-html.ts <notes.md> <out.html>");
}
writeFileSync(
  output,
  marked.parse(readFileSync(input, "utf8"), { async: false }),
  "utf8",
);
