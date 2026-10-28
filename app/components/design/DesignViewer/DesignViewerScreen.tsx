import type { DesignTab } from "../../../lib/routerDesign";
import type { FigmaFrameDetails } from "../../../lib/types";
import {
  Banner,
  Button,
  EmptyState,
  GridScreen,
  Icons,
  SegmentedControl,
  Spinner,
  ZoomPanImage,
} from "@argus/peacock";
import {
  designChangedSince,
  sessionRefFor,
  updateDesignViewer,
} from "../../../lib/designViewer";
import { openExternalUrl } from "../../../lib/ipc";
import { formatIssueDate } from "../../../lib/issueBoard";
import { useCurrentRoute } from "../../../lib/routeHooks";
import { useSessions } from "../../../stores/sessionStore";
import { useSessionDesignDevice } from "../../../stores/simulatorStore";
import { DesignComparePane } from "../DesignComparePane";
import { DesignSidePanel } from "./DesignSidePanel";
import styles from "./DesignViewer.module.css";
import { useFrameDetails } from "./useFrameDetails";

const MODES = [
  { value: "frame" as const, label: "Frame" },
  { value: "compare" as const, label: "Compare with simulator" },
];

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
  const changed = details
    ? designChangedSince(captured, details.file.version)
    : false;

  return (
    <GridScreen className={styles.screen}>
      <GridScreen.Header
        title={details?.frame.name ?? "Design"}
        subtitle={details ? subtitle(details) : "Figma"}
        actions={
          <div className={styles.actions}>
            {session && (
              <SegmentedControl
                aria-label="View"
                options={MODES}
                value={compare ? "compare" : "frame"}
                onChange={(mode) =>
                  updateDesignViewer({ compare: mode === "compare" })
                }
              />
            )}
            <Button
              variant="secondary"
              size="sm"
              leading={<Icons.ArrowUpRightIcon size={11} />}
              onClick={() => openExternalUrl(url).catch(() => {})}
            >
              Open in Figma
            </Button>
          </div>
        }
      />
      {changed && (
        <Banner tone="warning" leading={<Icons.WarningIcon size={12} />}>
          Design changed since this session started.
        </Banner>
      )}
      {!details && error && (
        <EmptyState
          icon={<Icons.WarningIcon size={20} />}
          title="Couldn't load the design"
          body={error}
        />
      )}
      {!details && !error && (
        <EmptyState icon={<Spinner size="md" />} title="Loading design" />
      )}
      {details && (
        <div className={styles.body}>
          <div className={styles.stage}>
            {compare && session ? (
              <DesignComparePane
                deviceKey={device.deviceKey}
                platform={device.platform}
                url={url}
              />
            ) : (
              <ZoomPanImage
                alt={details.frame.name}
                src={`data:image/png;base64,${details.frame.image}`}
                width={details.frame.width}
                height={details.frame.height}
              />
            )}
          </div>
          <DesignSidePanel details={details} tab={tab} />
        </div>
      )}
    </GridScreen>
  );
}

function subtitle(details: FigmaFrameDetails): string {
  return `${details.file.name} · Edited ${formatIssueDate(details.file.lastModified)}`;
}
