import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant =
  | "danger"
  | "ghost"
  | "primary"
  | "secondary"
  | "send"
  | "stop";
export type ButtonSize = "lg" | "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leading?: ReactNode;
  trailing?: ReactNode;
}

const sizeClass: Record<ButtonSize, string> = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
};

export function Button({
  variant = "primary",
  size = "md",
  leading,
  trailing,
  children,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const showSize = variant !== "send" && variant !== "stop";
  const classes = [
    styles.button,
    styles[variant],
    showSize ? sizeClass[size] : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {leading}
      {children}
      {trailing}
    </button>
  );
}
