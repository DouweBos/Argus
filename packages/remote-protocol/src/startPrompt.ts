/**
 * The first message of an agent started from issues and designs. Shared so
 * the desktop composer and the host (starting for the phone and the Mac app)
 * send agents the same thing.
 */

import type { DesignRef } from "./models/integrations";

const ISSUE_ONLY_PROMPT = "Work on this issue.";

function designSection(designs: DesignRef[]): string | null {
  if (designs.length === 0) {
    return null;
  }

  return [
    "## Design",
    "",
    "Match these Figma frames. Call `figma_get_frame` with each link for the image, layers and designer notes, and compare a simulator screenshot against the frame before you call the work done.",
    "",
    ...designs.map((d) => `- ${d.name}: ${d.url}`),
  ].join("\n");
}

/** Issue context, then the designs to match, then what the user typed (or a default ask). */
export function startPrompt(
  issueContexts: string[],
  designs: DesignRef[],
  prompt: string,
): string {
  const text = prompt.trim();
  const sections = [...issueContexts, designSection(designs)].filter(
    (section) => section !== null,
  );
  if (sections.length === 0) {
    return text;
  }

  return [
    ...sections,
    text || (issueContexts.length > 0 ? ISSUE_ONLY_PROMPT : ""),
  ]
    .filter(Boolean)
    .join("\n\n");
}
