import { LockIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import styles from "./DeviceControlOverlay.module.css";

export interface DeviceControlOverlayProps {
  /** Who is driving right now. `null` means you are — nothing is rendered. */
  holderLabel: string | null;
  onTakeControl: () => void;
  /** What is being driven, for the copy: a device, or an embedded browser. */
  subject?: "browser" | "device";
}

/**
 * "Controlled by …" scrim over a live device or browser picture.
 *
 * One host arbitrates input between every client watching a screen, and the
 * loser's touches are refused. Saying so up front — and blocking the pointer —
 * beats letting someone tap at a picture that never answers. The same overlay
 * covers simulators and the embedded browser: one arbitration scheme, one UX.
 */
export function DeviceControlOverlay({
  holderLabel,
  onTakeControl,
  subject = "device",
}: DeviceControlOverlayProps) {
  if (!holderLabel) {
    return null;
  }

  return (
    <div className={styles.overlay} role="status">
      <div className={styles.card}>
        <span className={styles.icon}>
          <LockIcon size={16} />
        </span>
        <p className={styles.title}>Controlled by {holderLabel}</p>
        <p className={styles.body}>
          {subject === "browser"
            ? "Another client is driving this browser. Its input wins until you take over."
            : "Another client is driving this device. Its input wins until you take over."}
        </p>
        <Button size="sm" variant="primary" onClick={onTakeControl}>
          Take control
        </Button>
      </div>
    </div>
  );
}
