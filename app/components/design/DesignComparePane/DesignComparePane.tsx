import type { ReactNode } from "react";
import { useState } from "react";
import { Badge, Button, Icons, ImageDiff, Spinner } from "@argus/peacock";
import styles from "./DesignComparePane.module.css";
import { formatDiffering, useDesignComparison } from "./useDesignComparison";

interface DesignComparePaneProps {
  deviceKey: string | null;
  /** Toolbar content before the result, e.g. a frame picker. */
  leading?: ReactNode;
  platform: "android" | "ios";
  /** Toolbar content after Retake. */
  trailing?: ReactNode;
  url: string;
}

const PNG = "data:image/png;base64,";

/** A frame against the device: the share that differs, and design, screen and heatmap. */
export function DesignComparePane({
  deviceKey,
  leading,
  platform,
  trailing,
  url,
}: DesignComparePaneProps) {
  const [nonce, setNonce] = useState(0);
  const { comparison, error, loading } = useDesignComparison(
    url,
    platform,
    deviceKey,
    nonce,
  );
  const tone =
    comparison && comparison.differingFraction < 0.02 ? "success" : "warning";

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {leading}
        <span className={styles.spacer} />
        {comparison && (
          <Badge tone={tone} size="tag">
            {formatDiffering(comparison.differingFraction)} differs
          </Badge>
        )}
        {loading && <Spinner size="xs" tone="muted" />}
        <Button
          variant="ghost"
          leading={<Icons.RefreshIcon size={11} />}
          disabled={loading || !deviceKey}
          onClick={() => setNonce((n) => n + 1)}
        >
          Retake screenshot
        </Button>
        {trailing}
      </div>
      {!deviceKey && (
        <p className={styles.hint}>
          No device to compare against yet — boot one in the runtime panel.
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}
      {comparison && (
        <div className={styles.diff}>
          <ImageDiff
            before={`${PNG}${comparison.design}`}
            after={`${PNG}${comparison.screenshot}`}
            diff={`${PNG}${comparison.diff}`}
            beforeLabel="Design"
            afterLabel={platform === "ios" ? "Simulator" : "Emulator"}
            diffLabel="Heatmap"
            beforeMeta={{ width: comparison.width, height: comparison.height }}
          />
        </div>
      )}
    </div>
  );
}
