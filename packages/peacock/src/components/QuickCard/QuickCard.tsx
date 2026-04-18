import type { HTMLAttributes, ReactNode } from "react";
import styles from "./QuickCard.module.css";

export interface QuickCardProps extends HTMLAttributes<HTMLDivElement> {
  heading?: ReactNode;
}

export function QuickCard({
  heading,
  children,
  className,
  ...rest
}: QuickCardProps) {
  return (
    <div
      className={[styles.card, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {heading && <h4 className={styles.heading}>{heading}</h4>}
      {children}
    </div>
  );
}

export interface MiniStatProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  accent?: boolean;
}

export function MiniStat({
  label,
  value,
  accent,
  className,
  ...rest
}: MiniStatProps) {
  return (
    <div
      className={[styles.miniStat, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span className={styles.label}>{label}</span>
      <span
        className={[styles.value, accent ? styles.accent : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
