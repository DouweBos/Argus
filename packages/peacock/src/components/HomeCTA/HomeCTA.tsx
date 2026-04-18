import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./HomeCTA.module.css";
import { PlusIcon } from "../../icons/Icons";

export interface HomeCTAProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  leading?: ReactNode;
}

export function HomeCTA({
  leading = <PlusIcon size={12} />,
  children = "Open repository",
  className,
  type = "button",
  ...rest
}: HomeCTAProps) {
  return (
    <button
      type={type}
      className={[styles.cta, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {leading}
      {children}
    </button>
  );
}
