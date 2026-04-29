import styles from "./Spinner.module.css";

export type SpinnerSize = "lg" | "md" | "sm" | "xs";
export type SpinnerTone = "muted" | "neutral" | "primary";

export interface SpinnerProps {
  /** Accessible label — rendered to screen readers via `aria-label`. */
  "aria-label"?: string;
  className?: string;
  size?: SpinnerSize;
  tone?: SpinnerTone;
}

/**
 * Determinate-looking rotating arc. Used for short background work where
 * progress percentage isn't meaningful (e.g. "fetching UI hierarchy").
 * Prefers-reduced-motion slows the animation to 2s per revolution.
 */
export function Spinner({
  "aria-label": ariaLabel = "Loading",
  className,
  size = "md",
  tone = "primary",
}: SpinnerProps) {
  const sizeClass: Record<SpinnerSize, string> = {
    xs: styles.sizeXs,
    sm: styles.sizeSm,
    md: styles.sizeMd,
    lg: styles.sizeLg,
  };
  const toneClass: Record<SpinnerTone, string> = {
    primary: styles.tonePrimary,
    neutral: styles.toneNeutral,
    muted: styles.toneMuted,
  };

  const classes = [
    styles.spinner,
    sizeClass[size],
    toneClass[tone],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <span role="status" aria-label={ariaLabel} className={classes} />;
}
