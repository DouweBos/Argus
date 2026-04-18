import type { HTMLAttributes, ReactNode } from "react";
import styles from "./TipCard.module.css";

export interface TipCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  icon?: ReactNode;
  body: ReactNode;
}

export function TipCard({ title, icon, body, className, ...rest }: TipCardProps) {
  return (
    <div className={[styles.tip, className].filter(Boolean).join(" ")} {...rest}>
      <div className={styles.head}>
        {icon && <span className={styles.glyph}>{icon}</span>}
        {title}
      </div>
      <div className={styles.body}>{body}</div>
    </div>
  );
}
