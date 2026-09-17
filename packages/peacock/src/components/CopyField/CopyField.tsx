import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "../../icons/Icons";
import styles from "./CopyField.module.css";

export interface CopyFieldProps {
  /** The text shown and copied. Truncates with an ellipsis when long. */
  value: string;
  /** Overrides the button's accessible name. */
  copyLabel?: string;
  /** Shown while the value is still being produced (e.g. a tunnel starting). */
  placeholder?: string;
  className?: string;
}

/**
 * A read-only value with a copy button — a share link, a pairing code, a path.
 *
 * The whole field is the button target: copying is the only thing anyone wants
 * to do with a value they cannot edit, so there is nothing to aim at.
 */
export function CopyField({
  value,
  copyLabel = "Copy",
  placeholder = "…",
  className,
}: CopyFieldProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const copy = () => {
    if (!value) {
      return;
    }
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        if (timer.current) {
          clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  };

  return (
    <button
      type="button"
      aria-label={copyLabel}
      className={[styles.field, className].filter(Boolean).join(" ")}
      disabled={!value}
      onClick={copy}
    >
      <code className={styles.value}>{value || placeholder}</code>
      <span className={styles.icon}>
        {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      </span>
      <span className={styles.state} role="status">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
