import {
  COLOR_THEME_IDS,
  COLOR_THEME_LABELS,
  type ColorThemeId,
} from "../../lib/colorThemes";
import styles from "./ColorThemePicker.module.css";

export interface ColorThemePickerProps {
  value: ColorThemeId;
  onChange: (value: ColorThemeId) => void;
  "aria-label"?: string;
}

/** Grid of colour theme presets, each previewed in the current scheme. */
export function ColorThemePicker({
  value,
  onChange,
  "aria-label": ariaLabel = "Colour theme",
}: ColorThemePickerProps) {
  return (
    <div aria-label={ariaLabel} className={styles.grid} role="radiogroup">
      {COLOR_THEME_IDS.map((id) => (
        <button
          key={id}
          aria-checked={value === id}
          className={`${styles.card} ${value === id ? styles.selected : ""}`}
          data-preset={id}
          role="radio"
          type="button"
          onClick={() => onChange(id)}
        >
          <span aria-hidden className={styles.preview}>
            <span className={styles.canvas} />
            <span className={styles.dot} />
          </span>
          <span className={styles.label}>{COLOR_THEME_LABELS[id]}</span>
        </button>
      ))}
    </div>
  );
}
