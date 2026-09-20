import type { HTMLAttributes, ReactNode } from "react";
import { CloseIcon } from "../../icons/Icons";
import styles from "./Banner.module.css";

export type BannerTone = "error" | "info" | "success" | "warning";

export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  tone?: BannerTone;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Renders a dismiss button at the end of the banner when provided. */
  onDismiss?: () => void;
  dismissLabel?: string;
}

const toneClass: Record<BannerTone, string> = {
  warning: styles.warning,
  error: styles.error,
  info: styles.info,
  success: styles.success,
};

export function Banner({
  tone = "info",
  leading,
  trailing,
  onDismiss,
  dismissLabel = "Dismiss",
  children,
  className,
  role,
  ...rest
}: BannerProps) {
  const classes = [styles.banner, toneClass[tone], className ?? ""]
    .filter(Boolean)
    .join(" ");

  const resolvedRole = role ?? (tone === "error" ? "alert" : "status");

  return (
    <div className={classes} role={resolvedRole} {...rest}>
      {leading && <span className={styles.leading}>{leading}</span>}
      <span className={styles.body}>{children}</span>
      {trailing && <span className={styles.trailing}>{trailing}</span>}
      {onDismiss && (
        <button
          type="button"
          className={styles.dismiss}
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <CloseIcon size={11} />
        </button>
      )}
    </div>
  );
}
