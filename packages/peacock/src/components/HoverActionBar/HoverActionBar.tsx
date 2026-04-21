import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import styles from "./HoverActionBar.module.css";

export type HoverActionBarPlacement =
  | "bottom-left"
  | "bottom-right"
  | "top-left"
  | "top-right";

export interface HoverActionBarProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  children: ReactNode;
  /** Which corner the bar anchors to. Defaults to `top-right`. */
  placement?: HoverActionBarPlacement;
}

const placementClass: Record<HoverActionBarPlacement, string> = {
  "bottom-left": styles.bottomLeft,
  "bottom-right": styles.bottomRight,
  "top-left": styles.topLeft,
  "top-right": styles.topRight,
};

/**
 * Absolute-positioned cluster of icon buttons that reveals on parent hover.
 *
 * The bar owns its visuals — gradient backdrop, blur, corner radius, spacing —
 * and defaults to `opacity: 0`. Callers opt in to reveal by toggling opacity
 * from their own `:hover` / `:focus-within` rules (pass an extra `className`
 * for the consumer CSS module to hook into).
 *
 * Pair with {@link HoverActionButton} for the icons inside. Example:
 *
 * ```tsx
 * <HoverActionBar placement="top-right" className={styles.actions}>
 *   <HoverActionButton icon={<CopyIcon />} label="Copy" onClick={onCopy} />
 *   <HoverActionButton icon={<BranchIcon />} label="Fork" onClick={onFork} />
 * </HoverActionBar>
 * ```
 *
 * And in the consumer CSS module:
 *
 * ```css
 * .messageBubble:hover .actions { opacity: 1; pointer-events: auto; }
 * ```
 */
export function HoverActionBar({
  children,
  className,
  placement = "top-right",
  ...rest
}: HoverActionBarProps) {
  const classes = [styles.bar, placementClass[placement], className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export interface HoverActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon element (typically a Peacock icon at size 11–12). */
  icon: ReactNode;
  /** Accessible label — also used as the native tooltip. */
  label: string;
}

/**
 * Small icon button styled to match {@link HoverActionBar}. Stops click
 * propagation so the button can sit inside a clickable card without firing
 * the outer click handler.
 */
export function HoverActionButton({
  icon,
  label,
  className,
  onClick,
  type = "button",
  ...rest
}: HoverActionButtonProps) {
  const classes = [styles.btn, className ?? ""].filter(Boolean).join(" ");

  return (
    <button
      aria-label={label}
      className={classes}
      onClick={(e) => {
        e.stopPropagation();
        // Blur so the bar's `:focus-within` reveal doesn't latch open after
        // a click — callers want the bar to fade out once the pointer
        // leaves, regardless of which button was last pressed.
        e.currentTarget.blur();
        onClick?.(e);
      }}
      title={label}
      type={type}
      {...rest}
    >
      {icon}
    </button>
  );
}
