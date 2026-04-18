import type { HTMLAttributes } from "react";
import styles from "./Kbd.module.css";

export interface KbdProps extends HTMLAttributes<HTMLSpanElement> {
  keys: string[];
}

export function Kbd({ keys, className, ...rest }: KbdProps) {
  return (
    <span className={[styles.group, className].filter(Boolean).join(" ")} {...rest}>
      {keys.map((k) => (
        <span key={k} className={styles.key}>
          {k}
        </span>
      ))}
    </span>
  );
}
