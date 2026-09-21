import styles from "./CronSchedulePreview.module.css";

export interface CronSchedulePreviewProps {
  /** Why the expression was rejected. Replaces the times when set. */
  error?: string | null;
  /** The zone the times are read in, shown so a schedule is unambiguous. */
  timezone?: string;
  /** The next few fire times, already formatted by the caller. */
  times: string[];
}

/**
 * The honest half of a cron input: the next few instants the expression
 * actually fires at. "Every five minutes" and "five past the hour" are one
 * character apart and look identical until you see them listed.
 */
export function CronSchedulePreview({
  error,
  timezone,
  times,
}: CronSchedulePreviewProps) {
  if (error) {
    return <p className={styles.error}>{error}</p>;
  }

  if (times.length === 0) {
    return <p className={styles.empty}>No upcoming runs.</p>;
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.caption}>
        Next runs{timezone ? ` · ${timezone}` : ""}
      </p>
      <ol className={styles.list}>
        {times.map((time) => (
          <li key={time} className={styles.item}>
            {time}
          </li>
        ))}
      </ol>
    </div>
  );
}
