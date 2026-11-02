/** Pure helpers behind the design viewer, shared by the desktop and the web client. */

import type { DesignRef, FigmaFrameDetails } from "@argus/remote-protocol";

const FIGMA_FILE_URL =
  /^https?:\/\/(?:www\.)?figma\.com\/(?:design|file|proto|board)\/([A-Za-z0-9]+)/i;

/** A figma.com file or frame link — the kind the design viewer can open. */
export function isFigmaUrl(url: string): boolean {
  return FIGMA_FILE_URL.test(url.trim());
}

/** `fileKey:nodeId` of a link, to tell two links to the same frame apart from the rest. */
export function figmaFrameKey(url: string): string | null {
  const trimmed = url.trim();
  const match = FIGMA_FILE_URL.exec(trimmed);
  if (!match) {
    return null;
  }
  const query = trimmed.includes("?")
    ? trimmed.split("?")[1].split("#")[0]
    : "";
  const node = new URLSearchParams(query).get("node-id");

  return `${match[1]}:${node ? node.replaceAll("-", ":") : ""}`;
}

/** The session's own reference for the frame on screen, if it has one. */
export function sessionRefFor(
  refs: DesignRef[] | null | undefined,
  ref: Pick<DesignRef, "fileKey" | "nodeId" | "url">,
): DesignRef | null {
  const key = figmaFrameKey(ref.url);

  return (
    refs?.find(
      (r) =>
        (r.fileKey === ref.fileKey && r.nodeId === ref.nodeId) ||
        (key !== null && figmaFrameKey(r.url) === key),
    ) ?? null
  );
}

/** True when the file has moved on since the session captured its reference. */
export function designChangedSince(
  captured: DesignRef | null,
  currentVersion: string,
): boolean {
  return !!captured?.version && captured.version !== currentVersion;
}

/** `4.2%` — the share of pixels that differ noticeably. */
export function formatDiffering(fraction: number): string {
  const pct = fraction * 100;

  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

const EDITED = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** `App · Edited Mar 4, 2026` — the viewer's header subtitle. */
export function designSubtitle(details: FigmaFrameDetails): string {
  return `${details.file.name} · Edited ${EDITED.format(new Date(details.file.lastModified))}`;
}

/** The pages-list key of the frame the details are for, as `figmaFrameKey` builds it. */
export function currentFrameKey(details: FigmaFrameDetails): string {
  return `${details.ref.fileKey}:${details.ref.nodeId ?? ""}`;
}
