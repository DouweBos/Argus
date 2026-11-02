import type { HTMLAttributes, ReactNode } from "react";
import styles from "./SettingsGroup.module.css";

/** A settings page's column: groups stacked with room between them. */
export function SettingsPageColumn({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[styles.page, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

export interface SettingsGroupProps {
  title?: string;
  /** On the title's line, far side: "Add", "Refresh". */
  accessory?: ReactNode;
  /** Small print under the card. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Argus for Mac's settings group: a quiet title, then its rows in one rounded
 * card split by hairlines.
 */
export function SettingsGroup({
  title,
  accessory,
  footer,
  children,
}: SettingsGroupProps) {
  return (
    <section className={styles.group}>
      {(title || accessory) && (
        <div className={styles.head}>
          {title && <h3 className={styles.title}>{title}</h3>}
          {accessory && <div className={styles.accessory}>{accessory}</div>}
        </div>
      )}
      <div className={styles.card}>{children}</div>
      {footer && <p className={styles.footer}>{footer}</p>}
    </section>
  );
}

export interface SettingsRowProps {
  title: ReactNode;
  description?: ReactNode;
  /** The control, sized to itself on the far side. */
  control?: ReactNode;
  /** Put the control under the label at full width (text fields, lists). */
  stacked?: boolean;
  /** More below the row, e.g. a hint or a list. */
  children?: ReactNode;
}

/** One setting: its name and what it does, and the control that changes it. */
export function SettingsRow({
  title,
  description,
  control,
  stacked,
  children,
}: SettingsRowProps) {
  const label = (
    <div className={styles.label}>
      <div className={styles.rowTitle}>{title}</div>
      {description && <div className={styles.description}>{description}</div>}
    </div>
  );

  return (
    <div className={styles.row}>
      {stacked ? (
        <>
          {label}
          {control && <div className={styles.stackedControl}>{control}</div>}
        </>
      ) : (
        <div className={styles.inline}>
          {label}
          {control && <div className={styles.control}>{control}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
