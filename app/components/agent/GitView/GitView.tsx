import { useMemo, useState } from "react";
import { useGlobalShortcuts } from "../../../hooks/useGlobalShortcuts";
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
  sessionId: string;
}

export function GitView({
  sessionId,
  baseBranch,
  branchName,
  repoRoot,
}: GitViewProps) {
  const [activeView, setActiveView] = useState<SourceView>("working-copy");
  const [fileCount, setFileCount] = useState(0);
  const [prevSessionId, setPrevSessionId] = useState(sessionId);

  // Reset file count when session changes so stale counts don't linger.
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId);
    setFileCount(0);
  }

  // Tower-style Cmd+1..4 sub-view switching. Active whenever GitView is mounted
  // (i.e. the center panel's git view is selected).
  const shortcuts = useMemo(
    () => [
      { key: "1", meta: true, handler: () => setActiveView("working-copy") },
      { key: "2", meta: true, handler: () => setActiveView("branch") },
      { key: "3", meta: true, handler: () => setActiveView("history") },
      { key: "4", meta: true, handler: () => setActiveView("stashes") },
    ],
    [],
  );
  useGlobalShortcuts(shortcuts);

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
          sessionId={sessionId}
          onFileCountChange={setFileCount}
        />
      )}

      {activeView === "branch" && <BranchView sessionId={sessionId} />}

      {activeView === "history" && <HistoryView sessionId={sessionId} />}

      {activeView === "stashes" && (
        <StashesView
          sessionId={sessionId}
          onRefresh={() => setActiveView("working-copy")}
        />
      )}
    </div>
  );
}
