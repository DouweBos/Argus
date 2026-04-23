import type { ReactNode } from "react";
import styles from "./SegmentedControl.module.css";

export type SegmentedControlSize = "md" | "sm";

export interface SegmentedOption<V extends string> {
  disabled?: boolean;
  label: ReactNode;
  value: V;
}

export interface SegmentedControlProps<V extends string> {
  "aria-label"?: string;
  className?: string;
  onChange: (value: V) => void;
  options: SegmentedOption<V>[];
  size?: SegmentedControlSize;
  value: V;
}

/**
 * Pill-style segmented control — one option always highlighted with the
 * accent colour, the others render as subdued text buttons. Use for
 * mutually-exclusive mode switches (Simulate / Inspect, Light / Dark, etc.).
 */
export function SegmentedControl<V extends string>({
  "aria-label": ariaLabel,
  className,
  onChange,
  options,
  size = "sm",
  value,
}: SegmentedControlProps<V>) {
  const sizeClass = size === "md" ? styles.sizeMd : styles.sizeSm;
  const rootClasses = [styles.root, sizeClass, className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClasses} role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value;
        const classes = [styles.segment, active ? styles.segmentActive : ""]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={classes}
            disabled={opt.disabled}
            onClick={() => {
              if (!active) {
                onChange(opt.value);
              }
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
