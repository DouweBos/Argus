import { LockIcon, SimulatorIcon } from "../../icons/Icons";
import { Avatar } from "../Avatar/Avatar";
import { Button } from "../Button/Button";
import { StatusBulb } from "../StatusBulb/StatusBulb";
import styles from "./DeviceClaimBar.module.css";

export interface DeviceClaimBarProps {
  /** Who is driving right now, or null when the device is free. */
  holderLabel: string | null;
  /** Whether that holder is us. */
  mine: boolean;
  onTakeControl: () => void;
  onRelease: () => void;
  /** Hides both buttons — a viewer who was never granted control. */
  readOnly?: boolean;
  className?: string;
}

/**
 * Who is driving a shared device, and the button that changes that.
 *
 * The claim is otherwise invisible until a tap is refused, which is a poor way
 * to find out. Stating it next to the picture — free, yours, or theirs — lets
 * someone take the device before they reach for it, and hand it back when they
 * are done rather than sitting on it until it idles out.
 */
export function DeviceClaimBar({
  holderLabel,
  mine,
  onTakeControl,
  onRelease,
  readOnly = false,
  className,
}: DeviceClaimBarProps) {
  let state: "free" | "mine" | "theirs" = "free";
  if (holderLabel !== null) {
    state = mine ? "mine" : "theirs";
  }

  return (
    <div className={[styles.bar, className].filter(Boolean).join(" ")}>
      <span className={styles.who}>
        {state === "theirs" ? (
          <Avatar name={holderLabel ?? ""} size={16} />
        ) : (
          <span className={styles.icon}>
            {state === "mine" ? (
              <StatusBulb pulse size="sm" tone="success" />
            ) : (
              <SimulatorIcon size={14} />
            )}
          </span>
        )}
        <span className={styles.label}>
          {state === "mine" && "You're driving"}
          {state === "free" && "Nobody is driving"}
          {state === "theirs" && `${holderLabel} is driving`}
        </span>
      </span>

      {!readOnly && state === "mine" && (
        <Button size="sm" variant="secondary" onClick={onRelease}>
          Hand back
        </Button>
      )}
      {!readOnly && state !== "mine" && (
        <Button size="sm" variant="primary" onClick={onTakeControl}>
          {state === "theirs" ? (
            <>
              <LockIcon size={12} /> Take control
            </>
          ) : (
            "Take control"
          )}
        </Button>
      )}
    </div>
  );
}
