import { CommitLogView } from "../CommitLogView";
import styles from "./HistoryView.module.css";

interface HistoryViewProps {
  sessionId: string;
}

export function HistoryView({ sessionId }: HistoryViewProps) {
  return (
    <div className={styles.container}>
      <CommitLogView allBranches showGraph sessionId={sessionId} />
    </div>
  );
}
