import { Avatar } from "../Avatar/Avatar";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { StatusBulb } from "../StatusBulb/StatusBulb";
import { TypingIndicator } from "../TypingIndicator/TypingIndicator";
import styles from "./GuestList.module.css";

export type GuestListItemState = "approved" | "denied" | "pending";

export interface GuestListItem {
  /** Stable identity — the ephemeral key a guest handshook with. */
  id: string;
  label: string;
  state: GuestListItemState;
  /** Whether their socket is live right now (they may have closed the tab). */
  connected: boolean;
  /**
   * They hold the device claim. At most one guest ever does, so the list reads
   * the same with two people or with six: one row is marked, the rest are not.
   */
  driving?: boolean;
  /** Composing a message right now — replaces the status line while it lasts. */
  typing?: boolean;
  /**
   * Their input is being refused because `driving` belongs to someone else —
   * they are tapping at a picture that isn't answering.
   */
  waiting?: boolean;
}

export interface GuestListProps {
  guests: GuestListItem[];
  /** Omitted for a read-only list (a guest looking at the other guests). */
  onApprove?: (id: string) => void;
  onDeny?: (id: string) => void;
  /**
   * Take someone already in the room back out — also how a row left behind by
   * a guest who has gone for good gets cleared.
   */
  onRemove?: (id: string) => void;
  /** Shown instead of a row when nobody has opened the link yet. */
  emptyLabel?: string;
  className?: string;
}

function statusLine(guest: GuestListItem): string {
  if (guest.state === "pending") {
    return "Wants to join";
  }
  if (guest.state === "denied") {
    return "Turned away";
  }

  // The grant is bound to the key that tab handshook with, so a guest who
  // closed it cannot walk back in on the link alone.
  return guest.connected
    ? "In the huddle"
    : "Left — they'd need letting in again";
}

function bulbTone(
  guest: GuestListItem,
): "error" | "neutral" | "pending" | "success" {
  if (guest.state === "pending") {
    return "pending";
  }
  if (guest.state === "denied") {
    return "error";
  }

  return guest.connected ? "success" : "neutral";
}

/**
 * Everyone in a shared room, however many that is — waiting, in, or turned
 * away — with the approve/deny decision on the rows that need one.
 *
 * Built for N from the start: pending guests sort to the top so a fourth
 * person arriving is never buried under the three already in, and exactly one
 * row can carry the "driving" mark, because the host's device claim only ever
 * grants one.
 */
export function GuestList({
  guests,
  onApprove,
  onDeny,
  onRemove,
  emptyLabel = "Nobody has opened the link yet.",
  className,
}: GuestListProps) {
  const order: Record<GuestListItemState, number> = {
    pending: 0,
    approved: 1,
    denied: 2,
  };
  const sorted = [...guests].sort((a, b) => order[a.state] - order[b.state]);

  if (sorted.length === 0) {
    return <p className={styles.empty}>{emptyLabel}</p>;
  }

  return (
    <ul className={[styles.list, className].filter(Boolean).join(" ")}>
      {sorted.map((guest) => (
        <li key={guest.id} className={styles.row}>
          <Avatar className={styles.avatar} name={guest.label} size={22} />
          <span className={styles.body}>
            <span className={styles.name}>
              {guest.label}
              {guest.driving && (
                <Badge size="pill" tone="accent">
                  Driving the device
                </Badge>
              )}
              {guest.waiting && !guest.driving && (
                <Badge size="pill" tone="warning">
                  Waiting for the device
                </Badge>
              )}
            </span>
            <span className={styles.status}>
              {guest.typing && guest.state === "approved" ? (
                <TypingIndicator label="Typing" />
              ) : (
                <>
                  <StatusBulb
                    size="sm"
                    tone={bulbTone(guest)}
                    pulse={guest.state === "pending"}
                  />
                  {statusLine(guest)}
                </>
              )}
            </span>
          </span>
          {guest.state === "pending" && onApprove && onDeny && (
            <span className={styles.actions}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDeny(guest.id)}
              >
                Deny
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => onApprove(guest.id)}
              >
                Allow
              </Button>
            </span>
          )}
          {guest.state !== "pending" && onRemove && (
            <span className={styles.actions}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRemove(guest.id)}
              >
                Remove
              </Button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
