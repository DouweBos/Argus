import type { DesignRef } from "../../../lib/types";
import { useEffect, useState } from "react";
import { Button, Icons, Select } from "@argus/peacock";
import { openDesignViewer } from "../../../lib/designViewer";
import { capture } from "../../../lib/telemetry";
import { DesignComparePane } from "../../design/DesignComparePane";
import styles from "./DesignCompare.module.css";

interface DesignCompareProps {
  deviceKey: string | null;
  platform: "android" | "ios";
  refs: DesignRef[];
  sessionId: string | null;
}

/**
 * The session's Figma frame against what the device shows: the share that
 * differs, side by side, under a slider, or as a heatmap.
 */
export function DesignCompare({
  deviceKey,
  platform,
  refs,
  sessionId,
}: DesignCompareProps) {
  const [index, setIndex] = useState(0);
  const ref = refs[Math.min(index, refs.length - 1)];

  useEffect(() => {
    capture("design_compare_opened");
  }, []);

  if (!ref) {
    return null;
  }

  return (
    <DesignComparePane
      deviceKey={deviceKey}
      platform={platform}
      url={ref.url}
      leading={
        refs.length > 1 ? (
          <Select
            aria-label="Design frame"
            value={String(index)}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {refs.map((r, i) => (
              <option key={r.url} value={i}>
                {r.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className={styles.name}>{ref.name}</span>
        )
      }
      trailing={
        <Button
          variant="ghost"
          leading={<Icons.FigmaIcon size={11} />}
          onClick={() => openDesignViewer(ref.url, "runtime", sessionId)}
        >
          Open in viewer
        </Button>
      }
    />
  );
}
