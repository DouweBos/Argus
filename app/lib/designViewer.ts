import type { DesignTab } from "./routerDesign";
import type { DesignRef } from "./types";
import { appNavigate, getCurrentRoute } from "./router";
import { capture } from "./telemetry";

export type DesignViewerSource = "composer" | "issue" | "runtime" | "session";

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

/** Open a Figma link in the design viewer, optionally against a session's device. */
export function openDesignViewer(
  url: string,
  source: DesignViewerSource,
  sessionId?: string | null,
): void {
  capture("design_viewer_opened", { source });
  appNavigate({
    view: "design",
    designUrl: url,
    designSessionId: sessionId ?? null,
    designTab: "layers",
    designCompare: false,
  });
}

/** Move within the open viewer — another frame, tab or mode — keeping the session. */
export function updateDesignViewer(change: {
  compare?: boolean;
  tab?: DesignTab;
  url?: string;
}): void {
  const route = getCurrentRoute();
  appNavigate({
    view: "design",
    designUrl: change.url ?? route.designUrl,
    designSessionId: route.designSessionId,
    designTab: change.tab ?? route.designTab,
    designCompare: change.compare ?? (change.url ? false : route.designCompare),
  });
}

/** A Markdown `onLinkClick` that opens Figma links in the viewer and leaves the rest alone. */
export function figmaLinkHandler(
  source: DesignViewerSource,
  sessionId?: string | null,
): (url: string) => boolean {
  return (url) => {
    if (!isFigmaUrl(url)) {
      return false;
    }
    openDesignViewer(url, source, sessionId);

    return true;
  };
}
