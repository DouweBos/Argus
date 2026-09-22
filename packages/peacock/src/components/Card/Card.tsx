import type { HTMLAttributes } from "react";
import styles from "./Card.module.css";

export type CardVariant = "dashed" | "glass" | "tight";
export type CardSize = "lg" | "md" | "sm";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  size?: CardSize;
  hoverable?: boolean;
  selected?: boolean;
  /** Stack the children in a column with a consistent gap. */
  stack?: boolean;
}

export function Card({
  variant = "glass",
  size = "md",
  hoverable,
  selected,
  stack,
  className,
  children,
  ...rest
}: CardProps) {
  const classes = [
    styles.card,
    variant === "dashed" ? styles.dashed : "",
    variant === "tight" ? styles.tight : "",
    size === "sm" ? styles.sm : "",
    size === "lg" ? styles.lg : "",
    hoverable ? styles.hoverable : "",
    selected ? styles.selected : "",
    stack ? styles.stack : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
