import { useId } from "react";
import type { ReactNode } from "react";
import styles from "./CheckboxRow.module.css";

export interface CheckboxRowProps {
  checked: boolean;
  /** Locks the row; pair with `checked` and a `trailing` note for "already done" items. */
  disabled?: boolean;
  /** Secondary line under the label, monospaced (paths, ids). */
  detail?: ReactNode;
  /** Full text for the hover tooltip when `detail` is shortened. */
  detailTitle?: string;
  label: ReactNode;
  /** Right-aligned metadata (counts, timestamps, status). */
  trailing?: ReactNode;
  onChange: (checked: boolean) => void;
}

/** A selectable list row: checkbox, bold label with a mono detail line, trailing meta. */
export function CheckboxRow({
  checked,
  disabled = false,
  detail,
  detailTitle,
  label,
  trailing,
  onChange,
}: CheckboxRowProps) {
  const id = useId();
  const cls = [styles.row, disabled && styles.disabled]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={cls} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className={styles.checkbox}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {detail !== undefined && (
          <span className={styles.detail} title={detailTitle}>
            {detail}
          </span>
        )}
      </span>
      {trailing !== undefined && (
        <span className={styles.trailing}>{trailing}</span>
      )}
    </label>
  );
}
