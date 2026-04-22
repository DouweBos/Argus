import type { HTMLAttributes, ReactNode } from "react";
import styles from "./FeedItem.module.css";

export type FeedItemTone =
  | "accent"
  | "error"
  | "muted"
  | "neutral"
  | "success"
  | "warning";

export interface FeedItemProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  icon: ReactNode;
  /** Tone applied to the icon tile. */
  tone?: FeedItemTone;
  /** Small uppercase chips rendered above the title (project, branch, source, etc). */
  chips?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  time?: ReactNode;
  /** Optional trailing slot (e.g. dismiss button) rendered next to the timestamp. */
  trailing?: ReactNode;
  /** Render with an opaque surface + border (notifications). Default false uses a hover-only row (activity). */
  bordered?: boolean;
}

const iconToneClass: Record<FeedItemTone, string> = {
  neutral: "",
  success: styles.iconSuccess,
  error: styles.iconError,
  warning: styles.iconWarning,
  accent: styles.iconAccent,
  muted: styles.iconMuted,
};

export function FeedItem({
  icon,
  tone = "neutral",
  chips,
  title,
  detail,
  time,
  trailing,
  bordered,
  className,
  ...rest
}: FeedItemProps) {
  const rowClasses = [
    styles.item,
    bordered ? styles.bordered : styles.hoverable,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const iconClasses = [styles.icon, iconToneClass[tone]]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rowClasses} {...rest}>
      <div className={iconClasses}>{icon}</div>
      <div className={styles.body}>
        {chips && <div className={styles.chips}>{chips}</div>}
        <div className={styles.title}>{title}</div>
        {detail && <div className={styles.detail}>{detail}</div>}
      </div>
      {(time || trailing) && (
        <div className={styles.trailing}>
          {time && <span className={styles.time}>{time}</span>}
          {trailing}
        </div>
      )}
    </div>
  );
}
