import styles from "./ColorSchemePicker.module.css";

export type ColorSchemePreference = "dark" | "light" | "system";

const SCHEMES: { value: ColorSchemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export interface ColorSchemePickerProps {
  value: ColorSchemePreference;
  onChange: (value: ColorSchemePreference) => void;
  "aria-label"?: string;
}

/** A sketch of the window: sidebar lines, a heading, a composer with the accent. */
function WindowSketch() {
  return (
    <span className={styles.window}>
      <span className={styles.sidebar}>
        <span className={styles.line} />
        <span className={`${styles.line} ${styles.strong}`} />
        <span className={styles.line} />
      </span>
      <span className={styles.content}>
        <span className={`${styles.line} ${styles.strong} ${styles.wide}`} />
        <span className={`${styles.line} ${styles.mid}`} />
        <span className={styles.composer}>
          <span className={`${styles.line} ${styles.mid}`} />
          <span className={styles.dot} />
        </span>
      </span>
    </span>
  );
}

/** System, Light and Dark as small window previews; System is half of each. */
export function ColorSchemePicker({
  value,
  onChange,
  "aria-label": ariaLabel = "Colour scheme",
}: ColorSchemePickerProps) {
  return (
    <div aria-label={ariaLabel} className={styles.grid} role="radiogroup">
      {SCHEMES.map((scheme) => (
        <button
          key={scheme.value}
          aria-checked={value === scheme.value}
          className={`${styles.card} ${value === scheme.value ? styles.selected : ""}`}
          role="radio"
          type="button"
          onClick={() => onChange(scheme.value)}
        >
          <span
            aria-hidden
            className={styles.preview}
            data-scheme={scheme.value}
          >
            {scheme.value === "system" ? (
              <>
                <span className={styles.half} data-scheme="dark">
                  <WindowSketch />
                </span>
                <span className={styles.half} data-scheme="light">
                  <WindowSketch />
                </span>
              </>
            ) : (
              <WindowSketch />
            )}
          </span>
          <span className={styles.label}>{scheme.label}</span>
        </button>
      ))}
    </div>
  );
}
