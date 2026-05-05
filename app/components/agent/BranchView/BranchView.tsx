import { CommitLogView } from "../CommitLogView";
import styles from "../HistoryView/HistoryView.module.css";

interface BranchViewProps {
  baseBranch?: string | null;
  sessionId: string;
}

export function BranchView({ sessionId, baseBranch }: BranchViewProps) {
  return (
    <div className={styles.container}>
      <CommitLogView
        allBranches={false}
        baseBranch={baseBranch}
        showGraph={false}
        sessionId={sessionId}
      />
    </div>
  );
}
