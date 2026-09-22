import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styles from "./DialogFooter.module.css";

export interface DialogFooterProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
  /** Left-aligned content (destructive action, helper text) placed before the spacer. */
  leading?: ReactNode;
}

/**
 * Bordered action bar pinned to the bottom of a `Dialog`. Must be a sibling of
 * `DialogBody`, not nested inside it, or it scrolls away with the content.
 */
export function DialogFooter({
  children,
  className,
  leading,
  ...rest
}: DialogFooterProps) {
  return (
    <div
      className={[styles.footer, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {leading && <div className={styles.leading}>{leading}</div>}
      {children}
    </div>
  );
}
