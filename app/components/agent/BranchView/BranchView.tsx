import { CommitLogView } from "../CommitLogView";
import styles from "../HistoryView/HistoryView.module.css";

interface BranchViewProps {
  workspaceId: string;
}

export function BranchView({ workspaceId }: BranchViewProps) {
  return (
    <div className={styles.container}>
      <CommitLogView allBranches={false} showGraph workspaceId={workspaceId} />
    </div>
  );
}
