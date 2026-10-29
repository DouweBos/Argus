import { useEffect, useState } from "react";
import { Spinner } from "../Spinner/Spinner";
import styles from "./BackgroundTaskStatus.module.css";
import { type BackgroundTaskData, backgroundTaskLabel } from "./backgroundTask";

export interface BackgroundTaskStatusProps {
  /** Off where the host already shows a spinner for it. */
  spinner?: boolean;
  task: BackgroundTaskData;
  /** Fixed clock for stories and tests; live otherwise. */
  now?: number;
}

function useNow(live: boolean, fixed?: number): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (!live || fixed != null) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [live, fixed]);

  return fixed ?? now;
}

/**
 * How a call launched with `run_in_background` is getting on: a spinner and a
 * live timer while it runs, then how long it took.
 */
export function BackgroundTaskStatus({
  task,
  now,
  spinner = true,
}: BackgroundTaskStatusProps) {
  const running = task.status === "running";
  const clock = useNow(running, now);

  return (
    <span className={`${styles.status} ${styles[task.status]}`}>
      {running && spinner && <Spinner size="xs" tone="primary" />}
      {backgroundTaskLabel(task, clock)}
    </span>
  );
}
