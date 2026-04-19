import type { Workspace } from "../../../lib/types";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ContextMenu,
  type ContextMenuItem,
  Icons,
  SidebarRepoAction,
  SidebarRepoGroup,
} from "@argus/peacock";
import { useWorkspaceDiffStats } from "../../../hooks/useWorkspaceDiffStats";
import { useProjectWorkspaces } from "../../../hooks/useWorkspaces";
import { createTerminal, revealInFinder } from "../../../lib/ipc";
import { workspaceStatusLabel } from "../../../lib/types";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useReviewQueueMap } from "../../../stores/reviewQueueStore";
import {
  selectWorkspace,
  useSelectedWorkspaceId,
  useSetupProgressByWorkspaceId,
} from "../../../stores/workspaceStore";
import { BranchSwitcher } from "../BranchSwitcher";
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

function toTildePath(absPath: string): string {
  const match = absPath.match(/^(\/(?:Users|home)\/[^/]+)/);

  return match ? absPath.replace(match[1], "~") : absPath;
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
  const [menuPosition, setMenuPosition] = useState<
    "anchor" | { x: number; y: number } | null
  >(null);

  const repoRootWorkspace = workspaces.find((w) => w.kind === "repo_root");
  const worktrees = workspaces.filter((w) => w.kind !== "repo_root");
  const isRepoHomeSelected =
    repoRootWorkspace != null && repoRootWorkspace.id === selectedId;

  const openProjectHome = () => {
    if (repoRootWorkspace) {
      selectWorkspace(repoRootWorkspace.id);
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const closeMenu = useCallback(() => setMenuPosition(null), []);

  const projectName = basename(repoRoot);

  return (
    <SidebarRepoGroup
      name={projectName}
      title={repoRoot}
      expanded={!isCollapsed}
      active={isRepoHomeSelected}
      leading={<Icons.FolderIcon size={11} />}
      onToggleExpanded={onToggleCollapsed}
      onHeaderClick={openProjectHome}
      onHeaderContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuPosition({ x: e.clientX, y: e.clientY });
      }}
      meta={
        repoRootWorkspace && (
          <RepoHeaderMeta workspace={repoRootWorkspace} />
        )
      }
      subtitle={
        isRepoHomeSelected && repoBranch ? (
          <div
            className={styles.branchSwitcherSlot}
            onClick={(e) => e.stopPropagation()}
          >
            <BranchSwitcher
              currentBranch={repoBranch}
              repoRoot={repoRoot}
              onBranchChanged={refresh}
            />
          </div>
        ) : (
          (repoBranch ?? repoRootWorkspace?.branch)
        )
      }
      endContent={
        repoRootWorkspace && <RepoHeaderStatus workspace={repoRootWorkspace} />
      }
      persistentAction={
        repoRootWorkspace && (
          <div
            className={styles.menuAnchor}
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarRepoAction
              title="Project options"
              onClick={(e) => {
                stop(e);
                setMenuPosition((prev) => (prev ? null : "anchor"));
              }}
            >
              <Icons.EllipsisIcon size={12} />
            </SidebarRepoAction>
            {menuPosition && (
              <ContextMenu
                items={
                  [
                    {
                      icon: <Icons.CopyIcon size={12} />,
                      label: "Copy Absolute Path",
                      onClick: () =>
                        navigator.clipboard.writeText(repoRootWorkspace.path),
                    },
                    {
                      icon: <Icons.CopyIcon size={12} />,
                      label: "Copy Relative Path",
                      onClick: () =>
                        navigator.clipboard.writeText(
                          toTildePath(repoRootWorkspace.path),
                        ),
                    },
                    {
                      icon: <Icons.BranchIcon size={12} />,
                      label: "Copy Branch Name",
                      onClick: () =>
                        navigator.clipboard.writeText(
                          repoBranch ?? repoRootWorkspace.branch,
                        ),
                    },
                    { separator: true },
                    {
                      icon: <Icons.FolderIcon size={12} />,
                      label: "Reveal in Finder",
                      onClick: () => revealInFinder(repoRootWorkspace.path),
                    },
                    {
                      icon: <Icons.TerminalIcon size={12} />,
                      label: "Open in Terminal",
                      onClick: () => {
                        createTerminal(repoRootWorkspace.id);
                      },
                    },
                  ] satisfies ContextMenuItem[]
                }
                position={menuPosition}
                onClose={closeMenu}
              />
            )}
          </div>
        )
      }
      actions={
        <>
          <SidebarRepoAction
            title="New workspace"
            onClick={(e) => {
              stop(e);
              setShowCreate(true);
            }}
          >
            <Icons.PlusIcon size={10} />
          </SidebarRepoAction>
          <SidebarRepoAction
            title="Project configuration"
            onClick={(e) => {
              stop(e);
              setShowConfig(true);
            }}
          >
            <Icons.GearIcon size={12} />
          </SidebarRepoAction>
          <SidebarRepoAction
            title="Close project"
            onClick={(e) => {
              stop(e);
              onClose();
            }}
          >
            <Icons.CloseIcon size={10} />
          </SidebarRepoAction>
        </>
      }
    >
      <div aria-label="Workspaces" className={styles.list} role="listbox">
        {worktrees.map((workspace) => (
          <WorkspaceCard
            key={workspace.id}
            isSelected={workspace.id === selectedId}
            workspace={workspace}
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
    </SidebarRepoGroup>
  );
}

function RepoHeaderMeta({ workspace }: { workspace: Workspace }) {
  const diffStats = useWorkspaceDiffStats(workspace.id, workspace.status);
  const reviewQueue = useReviewQueueMap();
  const commitsAhead = reviewQueue[workspace.id]?.commitsAhead ?? 0;

  if ((!diffStats || diffStats.files === 0) && commitsAhead === 0) {
    return null;
  }

  return (
    <>
      {diffStats && diffStats.files > 0 && (
        <span className={styles.diffStats}>
          <span className={styles.diffFileCount}>{diffStats.files}f</span>
          {diffStats.additions > 0 && (
            <span className={styles.diffAdd}>+{diffStats.additions}</span>
          )}
          {diffStats.deletions > 0 && (
            <span className={styles.diffRemove}>-{diffStats.deletions}</span>
          )}
        </span>
      )}
      {commitsAhead > 0 && (
        <span
          className={styles.aheadBadge}
          title={
            workspace.base_branch
              ? `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} ahead of ${workspace.base_branch}`
              : `${commitsAhead} unmerged commit${commitsAhead === 1 ? "" : "s"}`
          }
        >
          ↑{commitsAhead}
        </span>
      )}
    </>
  );
}

function RepoHeaderStatus({ workspace }: { workspace: Workspace }) {
  const agents = useAgentsRecord();
  const runningCount = useMemo(
    () =>
      Object.values(agents).filter(
        (a) => a.workspace_id === workspace.id && a.status === "running",
      ).length,
    [agents, workspace.id],
  );
  const setupProgressById = useSetupProgressByWorkspaceId();
  const setupProgress = setupProgressById[workspace.id];
  const statusLabel = workspaceStatusLabel(workspace.status);
  const showStatusBadge = statusLabel !== "ready";
  const errorMessage =
    typeof workspace.status === "object" && "error" in workspace.status
      ? workspace.status.error
      : null;
  const title =
    errorMessage ??
    (setupProgress?.item ? `Setup: ${setupProgress.item}` : undefined);

  if (runningCount === 0 && !showStatusBadge) {
    return null;
  }

  return (
    <>
      {runningCount > 0 && (
        <span
          className={styles.agentDot}
          title={`${runningCount} agent${runningCount > 1 ? "s" : ""} running`}
        />
      )}
      {showStatusBadge && (
        <span
          className={`${styles.statusBadge} ${styles[`ws_${statusLabel}`]}`}
          title={title}
        >
          {statusLabel}
        </span>
      )}
    </>
  );
}
