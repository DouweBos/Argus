import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import { listen } from "../../../lib/events";
import {
  createTerminal,
  revealInFinder,
  watchWorkspace,
} from "../../../lib/ipc";
import {
  type Workspace,
  isWorkspaceReady,
  workspaceStatusLabel,
} from "../../../lib/types";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useReviewQueueMap } from "../../../stores/reviewQueueStore";
import { useSetupProgressByWorkspaceId } from "../../../stores/workspaceStore";
import { ContextMenu, type ContextMenuItem } from "../../shared/ContextMenu";
import { BranchSwitcher } from "../BranchSwitcher";
import styles from "./WorkspaceCard.module.css";

const MAX_SUBTITLE_LEN = 36;

function truncateStart(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }

  return `…${str.slice(-(maxLen - 1))}`;
}

function repoBasenameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function toTildePath(absPath: string): string {
  const match = absPath.match(/^(\/(?:Users|home)\/[^/]+)/);

  return match ? absPath.replace(match[1], "~") : absPath;
}

interface WorkspaceCardProps {
  isSelected: boolean;
  onBranchChanged?: () => void;
  onDelete: () => Promise<void>;
  onSelect: () => void;
  repoBasename?: string;
  repoBranch?: string | null;
  repoRoot?: string;
  workspace: Workspace;
}

export function WorkspaceCard({
  workspace,
  repoBasename,
  isSelected,
  onSelect,
  onDelete,
  repoRoot,
  repoBranch,
  onBranchChanged,
}: WorkspaceCardProps) {
  const isRepoRoot = workspace.kind === "repo_root";
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuPosition, setMenuPosition] = useState<
    "anchor" | { x: number; y: number } | null
  >(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const setupProgressById = useSetupProgressByWorkspaceId();
  const setupProgress = setupProgressById[workspace.id];
  const reviewQueue = useReviewQueueMap();
  const commitsAhead = reviewQueue[workspace.id]?.commitsAhead ?? 0;
  const agents = useAgentsRecord();
  const runningCount = useMemo(
    () =>
      Object.values(agents).filter(
        (a) => a.workspace_id === workspace.id && a.status === "running",
      ).length,
    [agents, workspace.id],
  );

  // Diff stats
  const [diffStats, setDiffStats] = useState<{
    additions: number;
    deletions: number;
    files: number;
  } | null>(null);

  useEffect(() => {
    if (!isWorkspaceReady(workspace.status)) {
      return;
    }
    let cancelled = false;

    // Listen for diff stats pushed from the backend file watcher
    const unlistenPromise = listen<{
      additions: number;
      deletions: number;
      files: number;
    }>(`workspace:diff-changed:${workspace.id}`, (event) => {
      if (!cancelled) {
        setDiffStats(event.payload);
      }
    });

    // Start the backend file watcher (no-op if already running)
    watchWorkspace(workspace.id).catch(() => {
      // silently ignore — workspace may have been deleted
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [workspace.id, workspace.status]);

  const closeMenu = useCallback(() => setMenuPosition(null), []);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuPosition((prev) => (prev ? null : "anchor"));
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const effectiveRepoBasename =
    repoBasename ?? repoBasenameFromPath(workspace.repo_root);
  const projectName = isRepoRoot
    ? effectiveRepoBasename
    : (workspace.display_name ?? workspace.branch);
  const branchName = isRepoRoot
    ? (repoBranch ?? workspace.branch)
    : workspace.branch;
  const statusLabel = workspaceStatusLabel(workspace.status);
  const showStatusBadge = statusLabel !== "ready";
  const errorMessage =
    typeof workspace.status === "object" && "error" in workspace.status
      ? workspace.status.error
      : null;

  return (
    <div
      aria-selected={isSelected}
      className={`${styles.card} ${isSelected ? styles.selected : ""}`}
      role="option"
      tabIndex={0}
      onClick={onSelect}
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <div className={styles.main}>
        <div className={styles.left}>
          <div className={styles.titleRow}>
            {workspace.kind === "repo_root" ? (
              <Icons.RepoIcon size={11} />
            ) : (
              <Icons.BranchIcon size={11} />
            )}
            <span className={styles.projectName}>{projectName}</span>
            {diffStats && diffStats.files > 0 && (
              <span className={styles.diffStats}>
                <span className={styles.diffFileCount}>{diffStats.files}f</span>
                {diffStats.additions > 0 && (
                  <span className={styles.diffAdd}>+{diffStats.additions}</span>
                )}
                {diffStats.deletions > 0 && (
                  <span className={styles.diffRemove}>
                    -{diffStats.deletions}
                  </span>
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
          </div>
          <div className={styles.branchSubtitle}>
            {branchName}
            {workspace.description && (
              <span className={styles.descriptionInline}>
                {" "}
                &mdash; {workspace.description}
              </span>
            )}
          </div>
        </div>
        <div className={styles.right}>
          {runningCount > 0 && (
            <span
              className={`${styles.agentDot} ${styles.agent_running}`}
              title={`${runningCount} agent${runningCount > 1 ? "s" : ""} running`}
            />
          )}
          {showStatusBadge && (
            <span
              className={`${styles.statusBadge} ${styles[`ws_${statusLabel}`]}`}
              title={errorMessage ?? undefined}
            >
              {statusLabel}
            </span>
          )}
        </div>
      </div>
      {isRepoRoot &&
        repoRoot &&
        repoBranch &&
        onBranchChanged &&
        isSelected && (
          <div
            className={styles.branchRow}
            onClick={(e) => e.stopPropagation()}
          >
            <BranchSwitcher
              currentBranch={repoBranch}
              repoRoot={repoRoot}
              onBranchChanged={onBranchChanged}
            />
          </div>
        )}
      {workspace.status === "initializing" && setupProgress && (
        <div className={styles.setupProgressWrap}>
          {setupProgress.total > 0 && (
            <div
              aria-label="Setup progress"
              aria-valuemax={setupProgress.total}
              aria-valuemin={0}
              aria-valuenow={setupProgress.current}
              className={styles.progressBar}
              role="progressbar"
            >
              <div
                className={styles.progressBarFill}
                style={{
                  width: `${
                    (100 * setupProgress.current) / setupProgress.total
                  }%`,
                }}
              />
            </div>
          )}
          <p className={styles.setupProgress} title={setupProgress.item}>
            {truncateStart(setupProgress.item, MAX_SUBTITLE_LEN)}
          </p>
        </div>
      )}
      {errorMessage && (
        <div className={styles.errorWrap}>
          {setupProgress?.item && (
            <p
              className={styles.errorStep}
              title={`Failed at: ${setupProgress.item}`}
            >
              Failed at: {truncateStart(setupProgress.item, MAX_SUBTITLE_LEN)}
            </p>
          )}
          <p className={styles.errorMessage} title={errorMessage}>
            {errorMessage}
          </p>
        </div>
      )}

      <div className={styles.menuAnchor} onClick={(e) => e.stopPropagation()}>
        <button
          ref={menuBtnRef}
          className={`${styles.actionBtn} ${styles.ellipsisBtn}`}
          title="Workspace options"
          onClick={toggleMenu}
        >
          <Icons.EllipsisIcon size={12} />
        </button>
        {menuPosition && (
          <ContextMenu
            items={
              [
                {
                  icon: <Icons.CopyIcon size={12} />,
                  label: "Copy Absolute Path",
                  onClick: () => navigator.clipboard.writeText(workspace.path),
                },
                {
                  icon: <Icons.CopyIcon size={12} />,
                  label: "Copy Relative Path",
                  onClick: () =>
                    navigator.clipboard.writeText(toTildePath(workspace.path)),
                },
                {
                  icon: <Icons.BranchIcon size={12} />,
                  label: "Copy Branch Name",
                  onClick: () => navigator.clipboard.writeText(branchName),
                },
                { separator: true },
                {
                  icon: <Icons.FolderIcon size={12} />,
                  label: "Reveal in Finder",
                  onClick: () => revealInFinder(workspace.path),
                },
                {
                  icon: <Icons.TerminalIcon size={12} />,
                  label: "Open in Terminal",
                  onClick: () => {
                    createTerminal(workspace.id);
                  },
                },
                ...(!isRepoRoot
                  ? [
                      { separator: true as const },
                      {
                        icon: <Icons.TrashIcon size={12} />,
                        label: isDeleting ? "Deleting..." : "Delete Workspace",
                        onClick: handleDelete,
                        danger: true,
                        disabled: isDeleting,
                      },
                    ]
                  : []),
              ] satisfies ContextMenuItem[]
            }
            position={menuPosition}
            onClose={closeMenu}
          />
        )}
      </div>
    </div>
  );
}
