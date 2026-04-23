import type { ReactNode } from "react";
import styles from "./Toggle.module.css";

export type ToggleSize = "md" | "sm";

export interface ToggleProps {
  checked: boolean;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  onChange: (checked: boolean) => void;
  size?: ToggleSize;
}

/**
 * iOS-style switch. The track fills with the accent colour when checked and
 * the thumb slides across. Clicking the root toggles the state; a hidden
 * `<input type="checkbox">` carries focus so keyboard activation works.
 */
export function Toggle({
  checked,
  children,
  className,
  disabled = false,
  id,
  onChange,
  size = "sm",
}: ToggleProps) {
  const sizeClass = size === "md" ? styles.sizeMd : styles.sizeSm;
  const trackClasses = [styles.track, sizeClass, checked ? styles.checked : ""]
    .filter(Boolean)
    .join(" ");

  const rootClasses = [
    styles.root,
    checked ? styles.checked : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label
      className={rootClasses}
      aria-disabled={disabled || undefined}
      htmlFor={id}
    >
      <input
        id={id}
        type="checkbox"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={trackClasses}>
        <span className={styles.thumb} />
      </span>
      {children ? <span className={styles.label}>{children}</span> : null}
    </label>
  );
}
