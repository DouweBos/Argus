import { CommitLogView } from "../CommitLogView";
import styles from "../HistoryView/HistoryView.module.css";

interface BranchViewProps {
  sessionId: string;
}

export function BranchView({ sessionId }: BranchViewProps) {
  return (
    <div className={styles.container}>
      <CommitLogView allBranches={false} showGraph sessionId={sessionId} />
    </div>
  );
}
