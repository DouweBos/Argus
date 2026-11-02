import type { DesignComparison } from "@argus/remote-protocol";
import type { ReactNode } from "react";
import { RefreshIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { ImageDiff } from "../ImageDiff/ImageDiff";
import { Spinner } from "../Spinner/Spinner";
import styles from "./DesignComparePane.module.css";

export interface DesignComparePaneProps {
  comparison: DesignComparison | null;
  /** What the device's screenshot is called, e.g. "Simulator". */
  deviceLabel: string;
  /** The formatted share that differs, e.g. `4.2%`; shown as the result badge. */
  differing: string | null;
  error: string | null;
  hasDevice: boolean;
  /** Toolbar content before the result, e.g. a frame or device picker. */
  leading?: ReactNode;
  loading: boolean;
  /** Shown while there is no device to compare against. */
  noDeviceHint?: ReactNode;
  onRetake: () => void;
  /** Toolbar content after Retake. */
  trailing?: ReactNode;
}

const PNG = "data:image/png;base64,";

/** Under this share of differing pixels the result reads as a match. */
const MATCH_THRESHOLD = 0.02;

/** A frame against the device: the share that differs, and design, screen and heatmap. */
export function DesignComparePane({
  comparison,
  deviceLabel,
  differing,
  error,
  hasDevice,
  leading,
  loading,
  noDeviceHint = "No device to compare against yet — boot one in the runtime panel.",
  onRetake,
  trailing,
}: DesignComparePaneProps) {
  const tone =
    comparison && comparison.differingFraction < MATCH_THRESHOLD
      ? "success"
      : "warning";
  const notOnScreen = comparison?.match?.found === false;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {leading}
        <span className={styles.spacer} />
        {comparison && !notOnScreen && differing && (
          <Badge tone={tone} size="tag">
            {differing} differs
          </Badge>
        )}
        {notOnScreen && (
          <Badge tone="warning" size="tag">
            Not on screen
          </Badge>
        )}
        {loading && <Spinner size="xs" tone="muted" />}
        <Button
          variant="ghost"
          leading={<RefreshIcon size={11} />}
          disabled={loading || !hasDevice}
          onClick={onRetake}
        >
          Retake screenshot
        </Button>
        {trailing}
      </div>
      {!hasDevice && <p className={styles.hint}>{noDeviceHint}</p>}
      {error && <p className={styles.error}>{error}</p>}
      {notOnScreen && (
        <p className={styles.hint}>
          This component isn&rsquo;t on the device&rsquo;s screen. Scroll it
          into view, then retake the screenshot.
        </p>
      )}
      {comparison && !notOnScreen && (
        <div className={styles.diff}>
          <ImageDiff
            before={`${PNG}${comparison.design}`}
            after={`${PNG}${comparison.screenshot}`}
            diff={`${PNG}${comparison.diff}`}
            beforeLabel="Design"
            afterLabel={deviceLabel}
            diffLabel="Heatmap"
            beforeMeta={{ width: comparison.width, height: comparison.height }}
          />
        </div>
      )}
    </div>
  );
}
