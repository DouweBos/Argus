import type { HomeDirection } from "../useHomeDirection";
import styles from "./DirectionPicker.module.css";

const OPTIONS: { id: HomeDirection; label: string }[] = [
  { id: "command-center", label: "Command" },
  { id: "live-activity", label: "Activity" },
  { id: "orrery", label: "Orrery" },
];

export interface DirectionPickerProps {
  onChange: (direction: HomeDirection) => void;
  value: HomeDirection;
}

export function DirectionPicker({ value, onChange }: DirectionPickerProps) {
  return (
    <div className={styles.picker} role="tablist" aria-label="Home layout">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          role="tab"
          type="button"
          aria-selected={value === o.id}
          className={[styles.option, value === o.id ? styles.optionActive : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
