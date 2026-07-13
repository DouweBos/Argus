import type { HTMLAttributes, ReactNode } from "react";
import styles from "./QueuedMessage.module.css";

export interface QueuedMessageListProps extends HTMLAttributes<HTMLDivElement> {
  /** Section heading above the queued rows. */
  label?: string;
  children: ReactNode;
}

/** Section wrapping a stack of queued messages with an eyebrow label. */
export function QueuedMessageList({
  label = "Queued",
  children,
  className,
  ...rest
}: QueuedMessageListProps) {
  return (
    <div
      className={[styles.section, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span className={styles.label}>{label}</span>
      {children}
    </div>
  );
}

export interface QueuedMessageProps {
  /** Message text, shown in the default dashed bubble. Ignored when `children` is set. */
  text?: string;
  /** Custom body (e.g. an inline editor) replacing the default text bubble. */
  children?: ReactNode;
  /** Hover actions pinned to the row's top-right (e.g. edit / remove buttons). */
  actions?: ReactNode;
  /** Content beneath the row — linked-project chips, attachment thumbnails. */
  footer?: ReactNode;
}

/** A single queued message awaiting flush: dashed bubble + hover actions + footer. */
export function QueuedMessage({
  text,
  children,
  actions,
  footer,
}: QueuedMessageProps) {
  const body =
    children ?? (text ? <div className={styles.message}>{text}</div> : null);

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        {body}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {footer}
    </div>
  );
}

export interface QueuedMessageActionProps {
  /** Icon glyph for the button. */
  icon: ReactNode;
  /** Accessible label + tooltip. */
  label: string;
  onClick: () => void;
}

/** A compact bordered action button styled for a queued message row. */
export function QueuedMessageAction({
  icon,
  label,
  onClick,
}: QueuedMessageActionProps) {
  return (
    <button
      type="button"
      className={styles.actionButton}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
