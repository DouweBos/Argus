import { useState } from "react";
import { useProjectWorkspaces } from "../../hooks/useWorkspaces";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Workspace } from "../../lib/types";
import { WorkspaceCard } from "./WorkspaceCard";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { SetupConfigDialog } from "./SetupConfigDialog";
import {
  ChevronDownIcon,
  GearIcon,
  CloseIcon,
  PlusIcon,
} from "../shared/Icons";
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
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace);
  const [showCreate, setShowCreate] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<null | Workspace>(
    null,
  );

  // Sort repo_root workspaces first
  const sorted = [...workspaces].sort((a, b) => {
    if (a.kind === "repo_root" && b.kind !== "repo_root") return -1;
    if (a.kind !== "repo_root" && b.kind === "repo_root") return 1;
    return 0;
  });

  return (
    <div className={styles.segment}>
      <div
        className={styles.segmentHeader}
        onClick={onToggleCollapsed}
        title={repoRoot}
      >
        <ChevronDownIcon
          size={10}
          className={`${styles.collapseIcon} ${isCollapsed ? styles.collapsed : ""}`}
        />
        <span className={styles.projectName}>{basename(repoRoot)}</span>
        <div
          className={styles.headerActions}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={styles.headerBtn}
            onClick={() => setShowCreate(true)}
            title="New workspace"
          >
            <PlusIcon size={10} />
          </button>
          <button
            className={styles.headerBtn}
            onClick={() => setShowConfig(true)}
            title="Project configuration"
          >
            <GearIcon />
          </button>
          <button
            className={styles.headerBtn}
            onClick={onClose}
            title="Close project"
          >
            <CloseIcon size={10} />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className={styles.segmentBody}>
          <div
            className={styles.workspaceList}
            role="listbox"
            aria-label="Workspaces"
          >
            {sorted.map((workspace) => (
              <WorkspaceCard
                key={workspace.id}
                workspace={workspace}
                repoBasename={basename(repoRoot)}
                isSelected={workspace.id === selectedId}
                onSelect={() => selectWorkspace(workspace.id)}
                onDelete={async () => setWorkspaceToDelete(workspace)}
                repoRoot={workspace.kind === "repo_root" ? repoRoot : undefined}
                repoBranch={
                  workspace.kind === "repo_root" ? repoBranch : undefined
                }
                onBranchChanged={
                  workspace.kind === "repo_root" ? refresh : undefined
                }
              />
            ))}
          </div>
          <button
            className={styles.newWorkspaceBtn}
            onClick={() => setShowCreate(true)}
          >
            <PlusIcon size={10} />
            <span>New workspace</span>
          </button>
        </div>
      )}

      {showCreate && (
        <CreateWorkspaceDialog
          repoRoot={repoRoot}
          onClose={() => setShowCreate(false)}
        />
      )}

      {showConfig && (
        <SetupConfigDialog
          repoRoot={repoRoot}
          onClose={() => setShowConfig(false)}
        />
      )}

      {workspaceToDelete && (
        <DeleteWorkspaceDialog
          workspace={workspaceToDelete}
          onClose={() => setWorkspaceToDelete(null)}
          onConfirm={async (deleteBranch) => {
            await deleteWorkspace(workspaceToDelete.id, deleteBranch);
          }}
        />
      )}
    </div>
  );
}
