import type { Workspace } from "../../../lib/types";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Icons } from "@argus/peacock";
import { useProjectWorkspaces } from "../../../hooks/useWorkspaces";
import {
  selectWorkspace,
  useSelectedWorkspaceId,
} from "../../../stores/workspaceStore";
import { CreateWorkspaceDialog } from "../CreateWorkspaceDialog";
import { DeleteWorkspaceDialog } from "../DeleteWorkspaceDialog";
import { SetupConfigDialog } from "../SetupConfigDialog";
import { WorkspaceCard } from "../WorkspaceCard";
import styles from "./ProjectSegment.module.css";

interface ProjectSegmentProps {
  isCollapsed: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
  repoRoot: string;
}

function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

export function ProjectSegment({
  repoRoot,
  isCollapsed,
  onToggleCollapsed,
  onClose,
}: ProjectSegmentProps) {
  const { workspaces, repoBranch, deleteWorkspace, refresh } =
    useProjectWorkspaces(repoRoot);
  const selectedId = useSelectedWorkspaceId();
  const [showCreate, setShowCreate] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<Workspace | null>(
    null,
  );

  // Sort repo_root workspaces first
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
    <div className={styles.segment}>
      <div
        className={styles.segmentHeader}
        title={repoRoot}
        onClick={onToggleCollapsed}
      >
        <Icons.ChevronDownIcon
          className={`${styles.collapseIcon} ${isCollapsed ? styles.collapsed : ""}`}
          size={10}
        />
        <Icons.FolderIcon size={11} className={styles.folderIcon} />
        <span className={styles.projectName}>{basename(repoRoot)}</span>
        <div
          className={styles.headerActions}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={styles.headerBtn}
            title="New workspace"
            onClick={() => setShowCreate(true)}
          >
            <Icons.PlusIcon size={10} />
          </button>
          <button
            className={styles.headerBtn}
            title="Project configuration"
            onClick={() => setShowConfig(true)}
          >
            <Icons.GearIcon size={12} />
          </button>
          <button
            className={styles.headerBtn}
            title="Close project"
            onClick={onClose}
          >
            <Icons.CloseIcon size={10} />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className={styles.segmentBody}>
          <div
            aria-label="Workspaces"
            className={styles.workspaceList}
            role="listbox"
          >
            {sorted.map((workspace) => (
              <WorkspaceCard
                key={workspace.id}
                isSelected={workspace.id === selectedId}
                repoBasename={basename(repoRoot)}
                repoBranch={
                  workspace.kind === "repo_root" ? repoBranch : undefined
                }
                repoRoot={workspace.kind === "repo_root" ? repoRoot : undefined}
                workspace={workspace}
                onBranchChanged={
                  workspace.kind === "repo_root" ? refresh : undefined
                }
                onDelete={async () => setWorkspaceToDelete(workspace)}
                onSelect={() => selectWorkspace(workspace.id)}
              />
            ))}
          </div>
          <button
            className={styles.newWorkspaceBtn}
            onClick={() => setShowCreate(true)}
          >
            <Icons.PlusIcon size={10} />
            <span>New workspace</span>
          </button>
        </div>
      )}

      {showCreate &&
        createPortal(
          <CreateWorkspaceDialog
            repoRoot={repoRoot}
            sourceWorkspace={
              selectedId
                ? (workspaces.find(
                    (w) => w.id === selectedId && w.kind === "worktree",
                  ) ?? null)
                : null
            }
            onClose={() => setShowCreate(false)}
          />,
          document.body,
        )}

      {showConfig &&
        createPortal(
          <SetupConfigDialog
            repoRoot={repoRoot}
            onClose={() => setShowConfig(false)}
          />,
          document.body,
        )}

      {workspaceToDelete &&
        createPortal(
          <DeleteWorkspaceDialog
            workspace={workspaceToDelete}
            onClose={() => setWorkspaceToDelete(null)}
            onConfirm={async (deleteBranch) => {
              await deleteWorkspace(workspaceToDelete.id, deleteBranch);
            }}
          />,
          document.body,
        )}
    </div>
  );
}
