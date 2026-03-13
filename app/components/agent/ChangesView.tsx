import { useState, useEffect } from "react";
import { SourceSidebar } from "./SourceSidebar";
import { DiffViewer } from "./DiffViewer";
import { HistoryView } from "./HistoryView";
import { BranchView } from "./BranchView";
import { StashesView } from "./StashesView";
import styles from "./ChangesView.module.css";

export type SourceView = "working-copy" | "branch" | "history" | "stashes";

interface ChangesViewProps {
  baseBranch?: null | string;
  branchName?: string;
  repoRoot: string;
  workspaceId: string;
}

export function ChangesView({
  workspaceId,
  baseBranch,
  branchName,
  repoRoot,
}: ChangesViewProps) {
  const [activeView, setActiveView] = useState<SourceView>("working-copy");
  const [fileCount, setFileCount] = useState(0);

  // Reset file count when workspace changes so stale counts don't linger.
  useEffect(() => {
    setFileCount(0);
  }, [workspaceId]);

  return (
    <div className={styles.container}>
      <SourceSidebar
        activeView={activeView}
        onViewChange={setActiveView}
        fileCount={fileCount}
      />

      {activeView === "working-copy" && (
        <DiffViewer
          workspaceId={workspaceId}
          baseBranch={baseBranch}
          branchName={branchName}
          repoRoot={repoRoot}
          onFileCountChange={setFileCount}
        />
      )}

      {activeView === "branch" && <BranchView workspaceId={workspaceId} />}

      {activeView === "history" && <HistoryView workspaceId={workspaceId} />}

      {activeView === "stashes" && (
        <StashesView
          workspaceId={workspaceId}
          onRefresh={() => setActiveView("working-copy")}
        />
      )}
    </div>
  );
}
