import { useMemo } from "react";
import { EmptyState, Icons, WorkspaceCard } from "@argus/peacock";
import { setActiveTool } from "../../../stores/layoutStore";
import { useReviewQueueMap } from "../../../stores/reviewQueueStore";
import { selectWorkspace, useWorkspaces } from "../../../stores/workspaceStore";
import styles from "./ReviewQueueScreen.module.css";

function projectName(repoRoot: string): string {
  return repoRoot.split(/[/\\]/).filter(Boolean).pop() ?? repoRoot;
}

export function ReviewQueueScreen() {
  const counts = useReviewQueueMap();
  const workspaces = useWorkspaces();

  const items = useMemo(() => {
    const byId = new Map(workspaces.map((w) => [w.id, w]));

    return Object.entries(counts)
      .map(([workspaceId, commitsAhead]) => {
        const ws = byId.get(workspaceId);
        if (!ws) {
          return null;
        }

        return { workspace: ws, commitsAhead };
      })
      .filter(
        (x): x is { commitsAhead: number; workspace: (typeof workspaces)[0] } =>
          x !== null,
      )
      .sort((a, b) => b.commitsAhead - a.commitsAhead);
  }, [counts, workspaces]);

  const handleRowClick = (workspaceId: string) => {
    selectWorkspace(workspaceId);
    setActiveTool("changes");
  };

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <span className={styles.title}>Review queue</span>
        <span className={styles.sub}>
          {items.length === 0
            ? "Nothing ready to review"
            : `${items.length} workspace${items.length === 1 ? "" : "s"} with unmerged changes`}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Icons.MergeIcon size={20} />}
          title="No workspaces awaiting review"
          body="When an agent completes changes on a branch, it appears here ready to merge into its parent."
        />
      ) : (
        <div className={styles.list}>
          {items.map(({ workspace, commitsAhead }) => (
            <WorkspaceCard
              key={workspace.id}
              branch={workspace.display_name ?? workspace.branch}
              repo={projectName(workspace.repo_root)}
              parentBranch={
                workspace.base_branch
                  ? `${commitsAhead} ahead of ${workspace.base_branch}`
                  : `${commitsAhead} unmerged commit${commitsAhead === 1 ? "" : "s"}`
              }
              status="success"
              role="button"
              tabIndex={0}
              onClick={() => handleRowClick(workspace.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleRowClick(workspace.id);
                }
              }}
              className={styles.row}
            />
          ))}
        </div>
      )}
    </div>
  );
}
