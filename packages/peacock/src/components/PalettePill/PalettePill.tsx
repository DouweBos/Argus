import { forwardRef, type InputHTMLAttributes } from "react";
import { Kbd } from "../Kbd/Kbd";
import styles from "./PalettePill.module.css";

export interface PalettePillProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size"
> {
  hotkey?: string[];
  /** Leading prefix. Defaults to a forward slash. */
  prefix?: string;
}

export const PalettePill = forwardRef<HTMLInputElement, PalettePillProps>(
  function PalettePill(
    {
      hotkey = ["⌘", "K"],
      prefix = "/",
      placeholder = "Open repo · switch workspace · run command",
      className,
      ...rest
    },
    ref,
  ) {
    return (
      <div className={[styles.pill, className].filter(Boolean).join(" ")}>
        <span className={styles.slash}>{prefix}</span>
        <input
          ref={ref}
          className={styles.input}
          placeholder={placeholder}
          {...rest}
        />
        {hotkey && <Kbd keys={hotkey} />}
      </div>
    );
  },
);
