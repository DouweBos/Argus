import { CommitLogView } from "../CommitLogView";
import styles from "./HistoryView.module.css";

interface HistoryViewProps {
  scope?: "project" | "session";
  sessionId: string;
}

export function HistoryView({
  sessionId,
  scope = "session",
}: HistoryViewProps) {
  return (
    <div className={styles.column}>
      <div className={styles.container}>
        <CommitLogView
          allBranches
          showGraph
          scope={scope}
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}
