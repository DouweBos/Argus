import type { FigmaFrameDetails } from "@argus/remote-protocol";
import type { ReactNode } from "react";
import { ArrowUpRightIcon, WarningIcon } from "../../icons/Icons";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { GridScreen } from "../GridScreen/GridScreen";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { Spinner } from "../Spinner/Spinner";
import { ZoomPanImage } from "../ZoomPanImage/ZoomPanImage";
import { DesignSidePanel, type DesignViewerTab } from "./DesignSidePanel";
import styles from "./DesignViewer.module.css";

export type DesignViewerMode = "compare" | "frame";

export interface DesignViewerProps {
  /** Shown in the stage in compare mode, e.g. a `DesignComparePane`. */
  compare?: ReactNode;
  /** Label of the compare option in the mode toggle. */
  compareLabel?: string;
  /** The file moved on since the session captured the frame. */
  changed?: boolean;
  details: FigmaFrameDetails | null;
  error: string | null;
  /** Heading of the error state; `error` is its body. */
  errorTitle?: string;
  /** True for the page-list frame that is the one on screen. */
  isCurrentFrame: (url: string) => boolean;
  mode?: DesignViewerMode;
  /** Shows the frame/compare toggle when set. */
  onModeChange?: (mode: DesignViewerMode) => void;
  onOpenFrame: (url: string) => void;
  onOpenInFigma: () => void;
  onTabChange: (tab: DesignViewerTab) => void;
  /** Under the title once the frame loaded, e.g. the file and when it was edited. */
  subtitle?: string;
  tab: DesignViewerTab;
}

/** A Figma frame in full — zoomable, with its layers, comments and file — and optionally against a device. */
export function DesignViewer({
  compare,
  compareLabel = "Compare with device",
  changed = false,
  details,
  error,
  errorTitle = "Couldn't load the design",
  isCurrentFrame,
  mode = "frame",
  onModeChange,
  onOpenFrame,
  onOpenInFigma,
  onTabChange,
  subtitle,
  tab,
}: DesignViewerProps) {
  const modes = [
    { value: "frame" as const, label: "Frame" },
    { value: "compare" as const, label: compareLabel },
  ];

  return (
    <GridScreen className={styles.screen}>
      <GridScreen.Header
        title={details?.frame.name ?? "Design"}
        subtitle={details ? subtitle : "Figma"}
        actions={
          <div className={styles.actions}>
            {onModeChange && (
              <SegmentedControl<DesignViewerMode>
                aria-label="View"
                options={modes}
                value={mode}
                onChange={onModeChange}
              />
            )}
            <Button
              variant="secondary"
              size="sm"
              leading={<ArrowUpRightIcon size={11} />}
              onClick={onOpenInFigma}
            >
              Open in Figma
            </Button>
          </div>
        }
      />
      {changed && (
        <Banner tone="warning" leading={<WarningIcon size={12} />}>
          Design changed since this session started.
        </Banner>
      )}
      {!details && error && (
        <EmptyState
          icon={<WarningIcon size={20} />}
          title={errorTitle}
          body={error}
        />
      )}
      {!details && !error && (
        <EmptyState icon={<Spinner size="md" />} title="Loading design" />
      )}
      {details && (
        <div className={styles.body}>
          <div className={styles.stage}>
            {mode === "compare" && compare ? (
              compare
            ) : (
              <ZoomPanImage
                alt={details.frame.name}
                src={`data:image/png;base64,${details.frame.image}`}
                width={details.frame.width}
                height={details.frame.height}
              />
            )}
          </div>
          <DesignSidePanel
            details={details}
            isCurrentFrame={isCurrentFrame}
            onOpenFrame={onOpenFrame}
            onTabChange={onTabChange}
            tab={tab}
          />
        </div>
      )}
    </GridScreen>
  );
}
