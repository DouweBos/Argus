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
 * "Controlled by …" notice over a live device or browser picture.
 *
 * One host arbitrates input between every client watching a screen, and the
 * loser's touches are refused. The overlay blocks the pointer so nobody taps at
 * a picture that never answers, but leaves the picture itself in plain view:
 * watching someone demo is the point. One overlay for simulators and the
 * embedded browser: one arbitration scheme, one UX.
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
      <div
        className={styles.pill}
        title={`Another client is driving this ${subject}. Its input wins until you take over.`}
      >
        <span className={styles.icon}>
          <LockIcon size={12} />
        </span>
        <span className={styles.title}>Controlled by {holderLabel}</span>
        <Button size="sm" variant="primary" onClick={onTakeControl}>
          Take control
        </Button>
      </div>
    </div>
  );
}
