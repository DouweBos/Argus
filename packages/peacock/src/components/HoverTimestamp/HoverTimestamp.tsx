import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import styles from "./HoverTimestamp.module.css";

export interface HoverTimestampProps extends HTMLAttributes<HTMLDivElement> {
  timestamp: number;
  /** Optional range end. When set and different, displays "HH:MM–HH:MM". */
  endTimestamp?: number;
  children: ReactNode;
}

function formatTime(t: number) {
  return new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const HoverTimestamp = forwardRef<HTMLDivElement, HoverTimestampProps>(
  function HoverTimestamp(
    { timestamp, endTimestamp, children, className, ...rest },
    ref,
  ) {
    const hasRange = endTimestamp !== undefined && endTimestamp !== timestamp;
    const label = hasRange
      ? `${formatTime(timestamp)}–${formatTime(endTimestamp!)}`
      : formatTime(timestamp);
    const title = hasRange
      ? `${new Date(timestamp).toLocaleString()} – ${new Date(endTimestamp!).toLocaleString()}`
      : new Date(timestamp).toLocaleString();

    return (
      <div
        ref={ref}
        className={[styles.host, className].filter(Boolean).join(" ")}
        {...rest}
      >
        <time
          className={styles.stamp}
          dateTime={new Date(timestamp).toISOString()}
          title={title}
        >
          {label}
        </time>
        {children}
      </div>
    );
  },
);
