import type { HTMLAttributes, ReactNode } from "react";
import styles from "./SectionPanel.module.css";

export interface SectionPanelProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  plain?: boolean;
}

export function SectionPanel({
  title,
  meta,
  action,
  plain,
  className,
  children,
  ...rest
}: SectionPanelProps) {
  const classes = [styles.panel, plain ? styles.plain : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} {...rest}>
      <header className={styles.head}>
        <span className={styles.title}>{title}</span>
        {meta != null && <span className={styles.meta}>{meta}</span>}
        <span className={styles.spacer} />
        {action && <span className={styles.action}>{action}</span>}
      </header>
      {children}
    </section>
  );
}
