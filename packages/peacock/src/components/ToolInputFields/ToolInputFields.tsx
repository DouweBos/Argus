import type { ToolInputField } from "./fields";
import styles from "./ToolInputFields.module.css";

export interface ToolInputFieldsProps {
  fields: ToolInputField[];
  /** Escape hatch for surfaces that highlight text (search, mentions). */
  renderText?: (text: string) => React.ReactNode;
}

/**
 * A tool call's input, as labelled values.
 *
 * Every tool with a shape worth showing gets its own view; this is what the
 * rest get — never the raw JSON, which is noise around the two things worth
 * reading.
 */
export function ToolInputFields({
  fields,
  renderText = (t) => t,
}: ToolInputFieldsProps) {
  if (fields.length === 0) {
    return <p className={styles.empty}>No input</p>;
  }

  return (
    <dl className={styles.fields}>
      {fields.map((field) => (
        <div
          className={field.isLong ? styles.rowBlock : styles.row}
          key={field.label}
        >
          <dt className={styles.label}>{field.label}</dt>
          <dd className={styles.value}>{renderText(field.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
