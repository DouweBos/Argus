import { forwardRef, type ReactNode } from "react";
import styles from "./PropertyButton.module.css";

export interface PropertyButtonProps {
  disabled?: boolean;
  /** Whether its menu is open. */
  expanded?: boolean;
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
}

/** A property shown as its value — a pill that opens a menu to change it. */
export const PropertyButton = forwardRef<
  HTMLButtonElement,
  PropertyButtonProps
>(function PropertyButton({ disabled, expanded, icon, label, onClick }, ref) {
  return (
    <button
      ref={ref}
      aria-expanded={expanded}
      aria-haspopup="listbox"
      className={expanded ? styles.buttonOpen : styles.button}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span className={styles.label}>{label}</span>
    </button>
  );
});
