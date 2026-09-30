import type { Session } from "../../../lib/types";
import { ProgressBar } from "@argus/peacock";
import {
  deleteFraction,
  deleteProgressLabel,
  setupFraction,
  truncateStart,
} from "../../../lib/sessionProgress";
import {
  useDeleteProgressBySessionId,
  useSetupProgressBySessionId,
} from "../../../stores/sessionStore";
import styles from "./SessionProgress.module.css";

const MAX_LABEL_LEN = 36;

interface SessionProgressProps {
  session: Session;
}

/**
 * Bar and one-line label under a session that is being set up or removed.
 * The label is what moves during a long step, so a slow one reads as slow
 * rather than stuck.
 */
export function SessionProgress({ session }: SessionProgressProps) {
  const setupProgress = useSetupProgressBySessionId()[session.id];
  const deleteProgress = useDeleteProgressBySessionId()[session.id];

  if (session.status === "deleting") {
    const fraction = deleteFraction(deleteProgress);

    return (
      <div className={styles.wrap}>
        <ProgressBar
          size="xs"
          aria-label="Removal progress"
          progress={fraction ?? 0}
          indeterminate={fraction === null}
        />
        <p className={styles.label}>{deleteProgressLabel(deleteProgress)}</p>
      </div>
    );
  }

  if (session.status !== "initializing") {
    return null;
  }

  const fraction = setupFraction(setupProgress);
  const label = setupProgress
    ? (setupProgress.detail ?? truncateStart(setupProgress.item, MAX_LABEL_LEN))
    : "Preparing the worktree…";

  return (
    <div className={styles.wrap}>
      <ProgressBar
        size="xs"
        aria-label="Setup progress"
        progress={fraction ?? 0}
        indeterminate={fraction === null}
      />
      <p className={styles.label} title={setupProgress?.item}>
        {label}
      </p>
    </div>
  );
}
