/**
 * The first message of an agent started from issues and designs. Shared so
 * the desktop composer and the host (starting for the phone and the Mac app)
 * send agents the same thing.
 */

import type { DesignRef } from "./models/integrations";

const ISSUE_ONLY_PROMPT = "Work on this issue.";

/** Where a session's design references live in its worktree (kept out of git). */
export const DESIGN_DIR = ".argus/design";

/** `login-screen-12-34`: the file stem for a reference, stable per frame. */
export function designFileStem(design: DesignRef): string {
  const name = design.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const node = (design.nodeId ?? "file").replace(/[^0-9a-z]+/gi, "-");

  return `${name || "frame"}-${node}`;
}

function designSection(designs: DesignRef[]): string | null {
  if (designs.length === 0) {
    return null;
  }

  return [
    "## Design",
    "",
    "Match these Figma frames. Each one is also saved in your worktree as a PNG reference with a JSON of its layers (sizes, colors, fonts, text) and the designer's comments:",
    "",
    ...designs.map(
      (d) =>
        `- ${d.name}: ${d.url} → \`${DESIGN_DIR}/${designFileStem(d)}.png\` and \`.json\``,
    ),
    "",
    "Work in a loop while you build:",
    "1. `figma_get_frame` for the full spec, and `figma_export_assets` for icons and images rather than redrawing them.",
    "2. After each visible change, run the app on your simulator and call `design_compare` with the frame link. It renders the frame at your simulator's exact size, diffs it against the screen, and returns the score with a heatmap of what differs.",
    "3. Fix what the heatmap shows that isn't real data or the status bar, and compare again. `conductor assert-screenshot <reference.png> --threshold <n>` works on the same files for a pass/fail gate.",
    "",
    "Don't call UI work done until it matches the design; say in your final message which differences remain and why.",
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
