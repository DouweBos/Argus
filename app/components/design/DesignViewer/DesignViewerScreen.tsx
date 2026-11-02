import type { DesignTab } from "../../../lib/routerDesign";
import { currentFrameKey, designSubtitle } from "@argus/client-core";
import {
  DesignViewer as Viewer,
  EmptyState,
  GridScreen,
  Icons,
} from "@argus/peacock";
import {
  designChangedSince,
  figmaFrameKey,
  sessionRefFor,
  updateDesignViewer,
} from "../../../lib/designViewer";
import { openExternalUrl } from "../../../lib/ipc";
import { useCurrentRoute } from "../../../lib/routeHooks";
import { useSessions } from "../../../stores/sessionStore";
import { useSessionDesignDevice } from "../../../stores/simulatorStore";
import { DesignComparePane } from "../DesignComparePane";
import { useFrameDetails } from "./useFrameDetails";

/** A Figma frame in full — zoomable, with its layers, comments and file — and, from a session, against its device. */
export function DesignViewerScreen() {
  const { designUrl, designSessionId, designTab, designCompare } =
    useCurrentRoute();

  if (!designUrl) {
    return (
      <GridScreen>
        <EmptyState
          icon={<Icons.FigmaIcon size={20} />}
          title="No design open"
          body="Open a Figma link from an issue or a session to see it here."
        />
      </GridScreen>
    );
  }

  return (
    <DesignViewer
      compare={designCompare}
      sessionId={designSessionId}
      tab={designTab}
      url={designUrl}
    />
  );
}

interface DesignViewerProps {
  compare: boolean;
  sessionId: string | null;
  tab: DesignTab;
  url: string;
}

function DesignViewer({ compare, sessionId, tab, url }: DesignViewerProps) {
  const { details, error } = useFrameDetails(url);
  const session = useSessions().find((s) => s.id === sessionId) ?? null;
  const device = useSessionDesignDevice(session ? sessionId : null);
  const captured = details
    ? sessionRefFor(session?.design_refs, details.ref)
    : null;
  const current = details ? currentFrameKey(details) : null;

  return (
    <Viewer
      changed={
        details ? designChangedSince(captured, details.file.version) : false
      }
      compare={
        session && (
          <DesignComparePane
            deviceKey={device.deviceKey}
            platform={device.platform}
            url={url}
          />
        )
      }
      compareLabel="Compare with simulator"
      details={details}
      error={error}
      isCurrentFrame={(frameUrl) => figmaFrameKey(frameUrl) === current}
      mode={compare && session ? "compare" : "frame"}
      onModeChange={
        session
          ? (mode) => updateDesignViewer({ compare: mode === "compare" })
          : undefined
      }
      onOpenFrame={(frameUrl) => updateDesignViewer({ url: frameUrl })}
      onOpenInFigma={() => openExternalUrl(url).catch(() => {})}
      onTabChange={(next) => updateDesignViewer({ tab: next })}
      subtitle={details ? designSubtitle(details) : undefined}
      tab={tab}
    />
  );
}
