import type { Capture } from "./types";
import styles from "./A11yBadgeLayer.module.css";
import { selectNode, useInspectionSelection } from "./store";

interface A11yBadgeLayerProps {
  capture: Capture;
  scaleX: number;
  scaleY: number;
}

/**
 * Numbered accessibility-order badges overlaid on the capture. Clicking a
 * badge selects the underlying node so its full metadata (including all
 * a11y fields) appears in the side panel.
 */
export function A11yBadgeLayer({
  capture,
  scaleX,
  scaleY,
}: A11yBadgeLayerProps) {
  const { selectedNodeId } = useInspectionSelection();

  return (
    <div className={styles.layer}>
      {capture.a11ySnapshot.map((entry) => {
        const classes = [styles.badge];
        if (selectedNodeId === entry.nodeId) {
          classes.push(styles.badgeActive);
        }

        return (
          <div
            key={entry.nodeId}
            className={classes.join(" ")}
            style={{
              left: entry.frame.x * scaleX,
              top: entry.frame.y * scaleY,
            }}
            onClick={(e) => {
              e.stopPropagation();
              selectNode(entry.nodeId);
            }}
            title={entry.label ?? ""}
          >
            {entry.order}
          </div>
        );
      })}
    </div>
  );
}
