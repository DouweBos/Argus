import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./SegmentedCard.module.css";

export interface SegmentedCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  title: string;
  description: string;
  selected?: boolean;
}

export function SegmentedCard({
  icon,
  title,
  description,
  selected,
  className,
  ...rest
}: SegmentedCardProps) {
  return (
    <button
      type="button"
      className={[styles.card, selected ? styles.selected : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {icon ? <div className={styles.icon}>{icon}</div> : null}
      <div className={styles.title}>{title}</div>
      <div className={styles.description}>{description}</div>
    </button>
  );
}
