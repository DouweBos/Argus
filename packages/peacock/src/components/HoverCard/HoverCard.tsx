import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./HoverCard.module.css";

export interface HoverCardProps {
  /** What hovering reveals. */
  card: ReactNode;
  children: ReactNode;
  /** Milliseconds of hover before it shows. */
  delay?: number;
  /** Suppress it, e.g. while the trigger's own menu is open. */
  disabled?: boolean;
}

/** Extra detail about something, after hovering it for a moment. */
export function HoverCard({
  card,
  children,
  delay = 500,
  disabled = false,
}: HoverCardProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useLayoutEffect(() => {
    if (!open || !anchor.current) {
      return;
    }
    const r = anchor.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, r.left - 240), top: r.top });
  }, [open]);

  return (
    <span
      ref={anchor}
      className={styles.anchor}
      onPointerEnter={() => {
        clear();
        timer.current = window.setTimeout(() => setOpen(true), delay);
      }}
      onPointerLeave={() => {
        clear();
        setOpen(false);
      }}
      onPointerDown={() => {
        clear();
        setOpen(false);
      }}
    >
      {children}
      {open &&
        !disabled &&
        position &&
        createPortal(
          // Beside the trigger, toward the content, so it never covers its own menu.
          <div className={styles.card} role="tooltip" style={position}>
            {card}
          </div>,
          document.body,
        )}
    </span>
  );
}
