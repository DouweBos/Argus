import { useState } from "react";
import { BranchView } from "../BranchView";
import { DiffViewer } from "../DiffViewer";
import { HistoryView } from "../HistoryView";
import { SourceSidebar } from "../SourceSidebar";
import { StashesView } from "../StashesView";
import styles from "./GitView.module.css";

export type SourceView = "branch" | "history" | "stashes" | "working-copy";

interface GitViewProps {
  baseBranch?: string | null;
  branchName?: string;
  repoRoot: string;
  workspaceId: string;
}

export function GitView({
  workspaceId,
  baseBranch,
  branchName,
  repoRoot,
}: GitViewProps) {
  const [activeView, setActiveView] = useState<SourceView>("working-copy");
  const [fileCount, setFileCount] = useState(0);
  const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspaceId);

  // Reset file count when workspace changes so stale counts don't linger.
  if (workspaceId !== prevWorkspaceId) {
    setPrevWorkspaceId(workspaceId);
    setFileCount(0);
  }

  return (
    <div className={styles.container}>
      <SourceSidebar
        activeView={activeView}
        fileCount={fileCount}
        onViewChange={setActiveView}
      />

      {activeView === "working-copy" && (
        <DiffViewer
          baseBranch={baseBranch}
          branchName={branchName}
          repoRoot={repoRoot}
          workspaceId={workspaceId}
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
