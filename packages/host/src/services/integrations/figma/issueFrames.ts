/**
 * The Figma frames an issue links to, rendered, so an agent reading the ticket
 * sees the design without having to go and fetch it.
 */

import type { FigmaFrame } from "@argus/remote-protocol";
import { capture } from "../../telemetry/telemetry";
import { parseFigmaUrl } from "./refs";
import { figmaApi, figmaFrame } from "./service";

/** Frames rendered per issue; more would crowd the agent's context with images. */
export const MAX_ISSUE_FRAMES = 4;

export interface IssueFrame {
  url: string;
  fileKey: string;
  /** API form, `12:34`; null when the link points at the whole file. */
  nodeId: string | null;
  frame: FigmaFrame;
}

export interface IssueFrames {
  frames: IssueFrame[];
  /** Links that didn't render: no such node, no access, Figma down. */
  failed: string[];
  /** Links past the cap, left for `figma_get_frame`. */
  skipped: string[];
}

/** Resolves up to {@link MAX_ISSUE_FRAMES} distinct frames; failures are reported, never thrown. */
export async function resolveIssueFrames(
  urls: string[],
  fetchFrame: (url: string) => Promise<FigmaFrame | null> = figmaFrame,
): Promise<IssueFrames> {
  const seen = new Set<string>();
  const refs = urls.flatMap((url) => {
    const ref = parseFigmaUrl(url);
    const key = ref ? `${ref.fileKey}:${ref.nodeId ?? ""}` : null;
    if (!ref || !key || seen.has(key)) {
      return [];
    }
    seen.add(key);

    return [{ url, ...ref }];
  });
  const picked = refs.slice(0, MAX_ISSUE_FRAMES);
  const rendered = await Promise.all(
    picked.map((ref) => fetchFrame(ref.url).catch(() => null)),
  );
  const frames: IssueFrame[] = [];
  const failed: string[] = [];
  picked.forEach((ref, i) => {
    const frame = rendered[i];
    if (frame) {
      frames.push({ ...ref, frame });
    } else {
      failed.push(ref.url);
    }
  });

  return {
    frames,
    failed,
    skipped: refs.slice(MAX_ISSUE_FRAMES).map((r) => r.url),
  };
}

/** Text + images for `linear_get_issue`; empty when there are no links or Figma isn't connected. */
export async function issueFrameContent(
  urls: string[],
): Promise<
  (
    | { type: "image"; data: string; mimeType: string }
    | { type: "text"; text: string }
  )[]
> {
  if (urls.length === 0 || !figmaApi()) {
    return [];
  }
  const { frames, failed, skipped } = await resolveIssueFrames(urls);
  capture("issue_designs_resolved", {
    failed: failed.length,
    resolved: frames.length,
    skipped: skipped.length,
  });
  if (frames.length === 0 && failed.length === 0) {
    return [];
  }

  return [
    { type: "text", text: issueFramesText({ frames, failed, skipped }) },
    ...frames.map((f) => ({
      type: "image" as const,
      data: f.frame.image,
      mimeType: "image/png",
    })),
  ];
}

export function issueFramesText({
  frames,
  failed,
  skipped,
}: IssueFrames): string {
  const lines = ["## Figma designs linked in the issue"];
  frames.forEach((f, i) => {
    lines.push(
      "",
      `${i + 1}. **${f.frame.name}** (${f.frame.width}×${f.frame.height} pt) — file \`${f.fileKey}\`, node \`${f.nodeId ?? "whole file"}\``,
      `   ${f.url}`,
    );
  });
  if (frames.length > 0) {
    lines.push(
      "",
      "The frame images follow, in this order. Use `figma_get_frame` for a frame's layers and designer comments, and `design_compare` to check the running app against it.",
    );
  }
  if (failed.length > 0) {
    lines.push("", "Couldn't render:", ...failed.map((u) => `- ${u}`));
  }
  if (skipped.length > 0) {
    lines.push(
      "",
      "Not rendered (over the limit) — read with `figma_get_frame`:",
      ...skipped.map((u) => `- ${u}`),
    );
  }

  return lines.join("\n");
}
