import type { DeviceInfo } from "../../../lib/types";
import { deviceKeyFor } from "../../../stores/deviceStore";
import styles from "./DeviceGrid.module.css";
import { DeviceGridCell } from "./DeviceGridCell";

interface DeviceGridProps {
  devices: DeviceInfo[];
  interactiveKeys: Set<string>;
  /** Min column width (px) for each tile. */
  tileSize: number;
}

export function DeviceGrid({
  devices,
  interactiveKeys,
  tileSize,
}: DeviceGridProps) {
  if (devices.length === 0) {
    return (
      <div className={styles.empty}>
        Pick devices above to watch them live side by side.
      </div>
    );
  }

  return (
    <div
      className={styles.grid}
      style={{ "--tile-size": `${tileSize}px` } as React.CSSProperties}
    >
      {devices.map((d) => (
        <DeviceGridCell
          key={deviceKeyFor(d)}
          device={d}
          interactive={interactiveKeys.has(d.deviceKey)}
        />
      ))}
    </div>
  );
}
