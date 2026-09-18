import styles from "./ReportHeading.module.css";

export interface ReportHeadingProps {
  text: string;
}

/** The `heading` block — a section title inside a report. */
export function ReportHeading({ text }: ReportHeadingProps) {
  return <h3 className={styles.heading}>{text}</h3>;
}
