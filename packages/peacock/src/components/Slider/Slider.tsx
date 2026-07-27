import type { ReactNode } from "react";
import { useId } from "react";
import styles from "./Slider.module.css";

export interface SliderProps {
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  /** Optional label shown before the track. */
  label?: ReactNode;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}

/**
 * Native range input styled with Peacock tokens. The filled portion of the
 * track reflects the current value; the thumb picks up the accent colour.
 */
export function Slider({
  "aria-label": ariaLabel,
  className,
  disabled = false,
  id,
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: SliderProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  const rootClasses = [styles.root, className ?? ""].filter(Boolean).join(" ");

  return (
    <label
      className={rootClasses}
      aria-disabled={disabled || undefined}
      htmlFor={inputId}
    >
      {label ? <span className={styles.label}>{label}</span> : null}
      <input
        id={inputId}
        type="range"
        aria-label={ariaLabel}
        className={styles.input}
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--slider-fill": `${pct}%` } as React.CSSProperties}
      />
    </label>
  );
}
