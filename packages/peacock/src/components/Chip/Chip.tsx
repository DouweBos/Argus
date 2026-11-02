import type { HTMLAttributes, MouseEventHandler, ReactNode } from "react";
import { ChevronDownIcon, CloseIcon } from "../../icons/Icons";
import styles from "./Chip.module.css";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  leading?: ReactNode;
  mono?: boolean;
  muted?: boolean;
  interactive?: boolean;
  /** Strong active/checked state for togglable chips. */
  selected?: boolean;
  onDismiss?: MouseEventHandler<HTMLButtonElement>;
  /** No pill around it, as the Mac composer's chips sit in a row. */
  bare?: boolean;
  /** Opens a menu: a small chevron after the label. */
  menu?: boolean;
}

export function Chip({
  leading,
  mono,
  muted,
  interactive,
  selected,
  onDismiss,
  bare,
  menu,
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
    bare ? styles.bare : "",
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
      {menu && <ChevronDownIcon className={styles.chevron} size={9} />}
      {onDismiss && (
        <button
          type="button"
          className={styles.close}
          onClick={(e) => {
            // A dismissable chip may be clickable too; removing it isn't a click on it.
            e.stopPropagation();
            onDismiss(e);
          }}
          aria-label="Remove"
        >
          <CloseIcon size={10} />
        </button>
      )}
    </span>
  );
}
