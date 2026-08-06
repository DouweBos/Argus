import type { HTMLAttributes } from "react";
import styles from "./ColorSwatch.module.css";

export interface ColorSwatchProps extends HTMLAttributes<HTMLSpanElement> {
  /** Any CSS color the caller captured (e.g. `#RRGGBBAA` from a device). */
  color: string;
  /** Show the color string next to the chip. Defaults to true. */
  showValue?: boolean;
}

/**
 * A color chip + its value, used to surface captured device colors. The chip
 * sits over a checkerboard so partial alpha reads correctly. The color itself is
 * runtime data (not a design token), so it's applied inline by design.
 */
export function ColorSwatch({
  color,
  showValue = true,
  className,
  ...rest
}: ColorSwatchProps) {
  return (
    <span
      className={[styles.root, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span className={styles.chip}>
        <span className={styles.fill} style={{ background: color }} />
      </span>
      {showValue && <span className={styles.value}>{color}</span>}
    </span>
  );
}
