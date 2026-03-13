import { CommitLogView } from "./CommitLogView";
import styles from "./HistoryView.module.css";

interface HistoryViewProps {
  workspaceId: string;
}

export function HistoryView({ workspaceId }: HistoryViewProps) {
  return (
    <div className={styles.container}>
      <CommitLogView workspaceId={workspaceId} allBranches showGraph />
    </div>
  );
}
