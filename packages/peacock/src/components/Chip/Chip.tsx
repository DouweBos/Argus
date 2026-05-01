import type { HTMLAttributes, MouseEventHandler, ReactNode } from "react";
import { CloseIcon } from "../../icons/Icons";
import styles from "./Chip.module.css";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  leading?: ReactNode;
  mono?: boolean;
  muted?: boolean;
  interactive?: boolean;
  /** Strong active/checked state for togglable chips. */
  selected?: boolean;
  onDismiss?: MouseEventHandler<HTMLButtonElement>;
}

export function Chip({
  leading,
  mono,
  muted,
  interactive,
  selected,
  onDismiss,
  className,
  children,
  ...rest
}: ChipProps) {
  const classes = [
    styles.chip,
    mono ? styles.mono : "",
    muted ? styles.muted : "",
    interactive || rest.onClick ? styles.interactive : "",
    selected ? styles.selected : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      aria-pressed={interactive || rest.onClick ? selected : undefined}
      className={classes}
      {...rest}
    >
      {leading}
      {children}
      {onDismiss && (
        <button
          type="button"
          className={styles.close}
          onClick={onDismiss}
          aria-label="Remove"
        >
          <CloseIcon size={10} />
        </button>
      )}
    </span>
  );
}
