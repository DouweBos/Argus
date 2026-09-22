import { LockIcon } from "../../icons/Icons";
import { Avatar } from "../Avatar/Avatar";
import { StatusBulb } from "../StatusBulb/StatusBulb";
import styles from "./DeviceDriverBadge.module.css";

export interface DeviceDriverBadgeProps {
  /** Who is driving right now. `null` means nobody has taken it. */
  holderLabel: string | null;
  /**
   * People whose touches are being refused because `holderLabel` has it. The
   * whole point of the badge: a guest tapping at a picture that won't answer
   * is invisible to everyone except them.
   */
  waitingLabels?: string[];
  className?: string;
}

function waitingLine(labels: string[]): string {
  if (labels.length === 1) {
    return `${labels[0]} is trying to drive`;
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]} are trying to drive`;
  }

  return `${labels.length} people are trying to drive`;
}

/**
 * Who is driving a shared device, over the picture of it.
 *
 * Unlike {@link DeviceControlOverlay} this never blocks the pointer: it is for
 * the engineer at the machine, whose own touches are never arbitrated. They
 * can always reach in — they just need to know whether a guest is mid-gesture,
 * and whether someone else is tapping away getting nowhere.
 */
export function DeviceDriverBadge({
  holderLabel,
  waitingLabels = [],
  className,
}: DeviceDriverBadgeProps) {
  if (!holderLabel) {
    return null;
  }

  return (
    <div
      className={[styles.badge, className].filter(Boolean).join(" ")}
      role="status"
    >
      <span className={styles.driving}>
        <Avatar name={holderLabel} size={16} />
        <span className={styles.label}>{holderLabel} is driving</span>
      </span>
      {waitingLabels.length > 0 && (
        <span className={styles.waiting}>
          <StatusBulb pulse size="sm" tone="pending" />
          {waitingLine(waitingLabels)}
          <LockIcon size={11} />
        </span>
      )}
    </div>
  );
}
