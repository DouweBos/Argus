/**
 * The Figma frames an issue links to, listed as text. Images stay out: a few
 * rendered frames made the reply too large for the agent's MCP connection.
 */

import { capture } from "../../telemetry/telemetry";
import { parseFigmaUrl } from "./refs";
import { cachedFigmaFrame, figmaApi } from "./service";

/** Links listed per issue; the rest are counted. */
export const MAX_ISSUE_FRAMES = 20;

export interface IssueFrame {
  url: string;
  fileKey: string;
  /** API form, `12:34`; null when the link points at the whole file. */
  nodeId: string | null;
  /** From the frame cache only, never a fetch; null when not cached. */
  name: string | null;
}

/** Distinct frames the links point at, in order; non-Figma links are dropped. */
export function issueFrames(urls: string[]): IssueFrame[] {
  const seen = new Set<string>();

  return urls.flatMap((url) => {
    const ref = parseFigmaUrl(url);
    const key = ref ? `${ref.fileKey}:${ref.nodeId ?? ""}` : null;
    if (!ref || !key || seen.has(key)) {
      return [];
    }
    seen.add(key);

    return [{ url, ...ref, name: cachedFigmaFrame(url)?.name ?? null }];
  });
}

/** The listing for `linear_get_issue`; null when the issue links no frames. */
export function issueFramesText(urls: string[]): string | null {
  const frames = issueFrames(urls);
  if (frames.length === 0) {
    return null;
  }
  capture("issue_designs_resolved", {
    frames: frames.length,
    named: frames.filter((f) => f.name).length,
  });
  const lines = ["## Figma frames linked in the issue", ""];
  frames.slice(0, MAX_ISSUE_FRAMES).forEach((f, i) => {
    lines.push(
      `${i + 1}. ${f.name ? `**${f.name}**` : "Figma frame"} — file \`${f.fileKey}\`, node \`${f.nodeId ?? "whole file"}\``,
      `   ${f.url}`,
    );
  });
  const more = frames.length - MAX_ISSUE_FRAMES;
  if (more > 0) {
    lines.push(`…and ${more} more in the issue.`);
  }
  lines.push(
    "",
    figmaApi()
      ? "Fetch each frame's image and specs with `figma_get_frame` (pass its link), and check the running app against it with `design_compare`."
      : "Figma isn't connected in Argus, so these frames can't be fetched here. Ask the user to connect it in Settings → Integrations.",
  );

  return lines.join("\n");
}
