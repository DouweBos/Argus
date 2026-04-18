import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Eyebrow.module.css";

export interface EyebrowProps extends HTMLAttributes<HTMLDivElement> {
  count?: ReactNode;
}

export function Eyebrow({ count, children, className, ...rest }: EyebrowProps) {
  return (
    <div
      className={[styles.eyebrow, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span>{children}</span>
      {count != null && <span className={styles.count}>{count}</span>}
    </div>
  );
}
