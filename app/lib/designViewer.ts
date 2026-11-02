import type { DesignTab } from "./routerDesign";
import { isFigmaUrl } from "@argus/client-core";
import { appNavigate, getCurrentRoute } from "./router";
import { capture } from "./telemetry";

export {
  designChangedSince,
  figmaFrameKey,
  isFigmaUrl,
  sessionRefFor,
} from "@argus/client-core";

export type DesignViewerSource = "composer" | "issue" | "runtime" | "session";

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
