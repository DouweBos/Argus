import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import styles from "./SettingsScreen.module.css";

/**
 * iPad-style settings layout: a fixed-width left column of sections and a
 * scrolling right column with the active section's content.
 *
 * Composition:
 *
 *   <SettingsScreen>
 *     <SettingsScreenSidebar>
 *       <SettingsScreenSectionGroup label="General">
 *         <SettingsScreenSection ... />
 *         <SettingsScreenSection ... />
 *       </SettingsScreenSectionGroup>
 *     </SettingsScreenSidebar>
 *     <SettingsScreenDetail>
 *       <SettingsScreenDetailHeader title="..." />
 *       <SettingsScreenDetailBody>...</SettingsScreenDetailBody>
 *     </SettingsScreenDetail>
 *   </SettingsScreen>
 */
export function SettingsScreen({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[styles.screen, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SettingsScreenSidebar({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return (
    <aside
      className={[styles.sidebar, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </aside>
  );
}

export interface SettingsScreenSectionGroupProps
  extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
}

export function SettingsScreenSectionGroup({
  label,
  className,
  children,
  ...rest
}: SettingsScreenSectionGroupProps) {
  return (
    <div
      className={[styles.group, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {label != null && <div className={styles.groupLabel}>{label}</div>}
      <div className={styles.groupItems}>{children}</div>
    </div>
  );
}

export interface SettingsScreenSectionProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ReactNode;
  description?: ReactNode;
}

export function SettingsScreenSection({
  active,
  icon,
  description,
  children,
  className,
  type = "button",
  ...rest
}: SettingsScreenSectionProps) {
  const classes = [
    styles.section,
    active ? styles.sectionActive : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {icon != null && <span className={styles.sectionIcon}>{icon}</span>}
      <span className={styles.sectionText}>
        <span className={styles.sectionLabel}>{children}</span>
        {description != null && (
          <span className={styles.sectionDescription}>{description}</span>
        )}
      </span>
    </button>
  );
}

export function SettingsScreenDetail({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={[styles.detail, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </section>
  );
}

export interface SettingsScreenDetailHeaderProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function SettingsScreenDetailHeader({
  title,
  description,
  action,
  className,
  ...rest
}: SettingsScreenDetailHeaderProps) {
  return (
    <div
      className={[styles.detailHeader, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <div className={styles.detailHeaderText}>
        <h3 className={styles.detailTitle}>{title}</h3>
        {description != null && (
          <p className={styles.detailDescription}>{description}</p>
        )}
      </div>
      {action != null && (
        <div className={styles.detailHeaderAction}>{action}</div>
      )}
    </div>
  );
}

export function SettingsScreenDetailBody({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[styles.detailBody, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * A labelled block within the detail body. Pair with regular form controls
 * (Input, Toggle, etc.) for a consistent rhythm of label / caption / control.
 */
export interface SettingsScreenFieldProps
  extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  caption?: ReactNode;
}

export function SettingsScreenField({
  label,
  caption,
  className,
  children,
  ...rest
}: SettingsScreenFieldProps) {
  return (
    <div
      className={[styles.field, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <div className={styles.fieldLabel}>{label}</div>
      {caption != null && <div className={styles.fieldCaption}>{caption}</div>}
      <div className={styles.fieldControl}>{children}</div>
    </div>
  );
}
