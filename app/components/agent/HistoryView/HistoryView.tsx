import { CommitLogView } from "../CommitLogView";
import styles from "./HistoryView.module.css";

interface HistoryViewProps {
  baseBranch?: string | null;
  scope?: "project" | "session";
  sessionId: string;
}

export function HistoryView({
  sessionId,
  scope = "session",
  baseBranch,
}: HistoryViewProps) {
  return (
    <div className={styles.column}>
      <div className={styles.container}>
        <CommitLogView
          allBranches
          showGraph
          baseBranch={baseBranch}
          scope={scope}
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}
