import type { HTMLAttributes } from "react";
import styles from "./Card.module.css";

export type CardVariant = "glass" | "dashed" | "tight";
export type CardSize = "sm" | "md" | "lg";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  size?: CardSize;
  hoverable?: boolean;
  selected?: boolean;
}

export function Card({
  variant = "glass",
  size = "md",
  hoverable,
  selected,
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
