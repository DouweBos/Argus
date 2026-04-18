import type { HTMLAttributes, ReactNode } from "react";
import { ArgusLogo } from "../../icons/Icons";
import styles from "./EmptyHome.module.css";

export interface EmptyHomeProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  title?: ReactNode;
  tagline?: ReactNode;
  /** Primary/secondary CTAs, rendered in a row. */
  actions?: ReactNode;
  /** Tip card row (typically 3 TipCards). */
  tips?: ReactNode;
  /** Shortcuts footer — free-form content (e.g., inline Kbd rows). */
  shortcuts?: ReactNode;
  /** Show the radial accent glow backdrop. Defaults to true. */
  glow?: boolean;
}

export function EmptyHome({
  title = "Argus",
  tagline = "parallel agentic mobile & web dev",
  actions,
  tips,
  shortcuts,
  glow = true,
  className,
  ...rest
}: EmptyHomeProps) {
  return (
    <div
      className={[styles.wrap, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {glow && <div className={styles.glow} aria-hidden />}
      <div className={styles.brand}>
        <div className={styles.logo}>
          <ArgusLogo size={56} />
        </div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.tagline}>{tagline}</p>
      </div>
      {actions && <div className={styles.ctas}>{actions}</div>}
      {tips && <div className={styles.tips}>{tips}</div>}
      {shortcuts && <div className={styles.shortcuts}>{shortcuts}</div>}
    </div>
  );
}
