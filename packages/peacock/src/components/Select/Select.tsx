import type { SelectHTMLAttributes } from "react";
import { forwardRef } from "react";
import { ChevronDownIcon } from "../../icons/Icons";
import styles from "./Select.module.css";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  mono?: boolean;
}

/** Native `<select>` styled to match {@link Input}. Children are `<option>`s. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ mono, className, children, ...rest }, ref) {
    const classes = [styles.select, mono ? styles.mono : "", className ?? ""]
      .filter(Boolean)
      .join(" ");

    return (
      <span className={styles.wrap}>
        <select className={classes} ref={ref} {...rest}>
          {children}
        </select>
        <ChevronDownIcon className={styles.chevron} />
      </span>
    );
  },
);
