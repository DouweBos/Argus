import type { CSSProperties } from "react";
import styles from "./LabelChip.module.css";

export interface LabelChipProps {
  /** The tracker's own label color — runtime data, so it's applied inline. */
  color?: string | null;
  name: string;
}

/** A tracker label: a colored dot and its name. */
export function LabelChip({ color, name }: LabelChipProps) {
  const dot = color ? ({ "--label-color": color } as CSSProperties) : undefined;

  return (
    <span className={styles.chip}>
      <span className={styles.dot} style={dot} />
      {name}
    </span>
  );
}
