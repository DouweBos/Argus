import type { DeviceInfo } from "../../../lib/types";
import { Icons, Toggle } from "@argus/peacock";
import { deviceDisplayName } from "../../../lib/deviceHost";
import {
  removeGridSelected,
  setGridInteractive,
} from "../../../stores/deviceGridStore";
import { DevicePreview } from "../DeviceDialog/DevicePreview";
import styles from "./DeviceGrid.module.css";

interface DeviceGridCellProps {
  device: DeviceInfo;
  interactive: boolean;
}

/**
 * One tile in the multi-device grid. Compact view-only monitor by default; the
 * header toggle flips it to a fully interactive preview (tap/type + controls).
 */
export function DeviceGridCell({ device, interactive }: DeviceGridCellProps) {
  return (
    <div
      className={`${styles.cell} ${interactive ? styles.cellInteractive : ""}`}
    >
      <div className={styles.head}>
        <span className={styles.name} title={deviceDisplayName(device)}>
          {deviceDisplayName(device)}
        </span>
        <div className={styles.headActions}>
          <Toggle
            checked={interactive}
            onChange={(on) => setGridInteractive(device.deviceKey, on)}
          >
            Interact
          </Toggle>
          <button
            type="button"
            className={styles.iconBtn}
            title="Remove from grid"
            onClick={() => removeGridSelected(device.deviceKey)}
          >
            <Icons.CloseIcon size={12} />
          </button>
        </div>
      </div>
      <div
        className={`${styles.body} ${interactive ? styles.bodyInteractive : styles.bodyCompact}`}
      >
        <DevicePreview device={device} interactive={interactive} />
      </div>
    </div>
  );
}
