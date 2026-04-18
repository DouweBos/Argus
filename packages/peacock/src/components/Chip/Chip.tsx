import type { HTMLAttributes, MouseEventHandler, ReactNode } from "react";
import styles from "./Chip.module.css";
import { CloseIcon } from "../../icons/Icons";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  leading?: ReactNode;
  mono?: boolean;
  muted?: boolean;
  interactive?: boolean;
  onDismiss?: MouseEventHandler<HTMLButtonElement>;
}

export function Chip({
  leading,
  mono,
  muted,
  interactive,
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
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} {...rest}>
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
