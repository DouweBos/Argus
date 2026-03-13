import { CommitLogView } from "./CommitLogView";
import styles from "./HistoryView.module.css";

interface BranchViewProps {
  workspaceId: string;
}

export function BranchView({ workspaceId }: BranchViewProps) {
  return (
    <div className={styles.container}>
      <CommitLogView workspaceId={workspaceId} allBranches={false} showGraph />
    </div>
  );
}
