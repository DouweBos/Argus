import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./FlatIconButton.module.css";

export interface FlatIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name and tooltip. */
  label: string;
  icon: ReactNode;
  /** Lit: a menu it opens is up, or the view it toggles is on. */
  selected?: boolean;
  size?: "lg" | "md" | "sm";
  /** A small count pinned to the top-right corner; hidden at 0. */
  badge?: number;
}

/**
 * The Mac chrome's icon button: no box until hovered, a quiet fill when lit.
 * Sidebar, toolbar, tab strip and card all use it.
 */
export const FlatIconButton = forwardRef<
  HTMLButtonElement,
  FlatIconButtonProps
>(function FlatIconButton(
  {
    label,
    icon,
    selected,
    size = "md",
    badge,
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      aria-pressed={selected}
      className={[styles.button, styles[size], className]
        .filter(Boolean)
        .join(" ")}
      data-selected={selected || undefined}
      title={label}
      type={type}
      {...rest}
    >
      {icon}
      {badge != null && badge > 0 && (
        <span className={styles.badge}>{badge > 99 ? "99+" : badge}</span>
      )}
    </button>
  );
});
