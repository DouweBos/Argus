import type { ReactNode } from "react";
import styles from "./FormField.module.css";

export interface FormFieldProps {
  label: string;
  helper?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}

export function FormField({
  label,
  helper,
  error,
  htmlFor,
  children,
}: FormFieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className={styles.error}>{error}</span>
      ) : helper ? (
        <span className={styles.helper}>{helper}</span>
      ) : null}
    </div>
  );
}
