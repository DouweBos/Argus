import type { Workspace } from "../../../lib/types";
import { WorkspaceCard } from "../WorkspaceCard";
import styles from "./WorkspaceList.module.css";

interface WorkspaceListProps {
  deleteWorkspace: (id: string) => Promise<void>;
  isLoading?: boolean;
  selectedId: string | null;
  selectWorkspace: (id: string) => void;
  workspaces: Workspace[];
}

export function WorkspaceList({
  workspaces,
  selectedId,
  selectWorkspace,
  deleteWorkspace,
  isLoading,
}: WorkspaceListProps) {
  if (isLoading && workspaces.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.spinner} />
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>No workspaces yet.</p>
        <p className={styles.emptyHint}>Create a workspace to get started.</p>
      </div>
    );
  }

  // Sort repo_root workspaces first.
  const sorted = [...workspaces].sort((a, b) => {
    if (a.kind === "repo_root" && b.kind !== "repo_root") {
      return -1;
    }
    if (a.kind !== "repo_root" && b.kind === "repo_root") {
      return 1;
    }

    return 0;
  });

  return (
    <div aria-label="Workspaces" className={styles.list} role="listbox">
      {sorted.map((workspace) => (
        <WorkspaceCard
          key={workspace.id}
          isSelected={workspace.id === selectedId}
          workspace={workspace}
          onDelete={() => deleteWorkspace(workspace.id)}
          onSelect={() => selectWorkspace(workspace.id)}
        />
      ))}
    </div>
  );
}
