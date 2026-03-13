import { useState, useRef, useEffect } from "react";
import { useAgentStore } from "../../stores/agentStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { listen } from "../../lib/events";
import {
  workspaceStatusLabel,
  isWorkspaceReady,
  type Workspace,
} from "../../lib/types";
import { watchWorkspace, unwatchWorkspace } from "../../lib/ipc";
import { RepoIcon, BranchIcon, EllipsisIcon, TrashIcon } from "../shared/Icons";
import { BranchSwitcher } from "./BranchSwitcher";
import styles from "./WorkspaceCard.module.css";

const MAX_SUBTITLE_LEN = 36;

function truncateStart(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `…${str.slice(-(maxLen - 1))}`;
}

function repoBasenameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

interface WorkspaceCardProps {
  isSelected: boolean;
  onBranchChanged?: () => void;
  onDelete: () => Promise<void>;
  onSelect: () => void;
  repoBasename?: string;
  repoBranch?: null | string;
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
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const setupProgress = useWorkspaceStore(
    (s) => s.setupProgressByWorkspaceId[workspace.id],
  );
  const runningCount = useAgentStore(
    (s) =>
      s.getAgentsByWorkspace(workspace.id).filter((a) => a.status === "running")
        .length,
  );

  // Diff stats
  const [diffStats, setDiffStats] = useState<{
    additions: number;
    deletions: number;
    files: number;
  } | null>(null);

  useEffect(() => {
    if (!isWorkspaceReady(workspace.status)) return;
    let cancelled = false;

    // Listen for diff stats pushed from the backend file watcher
    const unlistenPromise = listen<{
      additions: number;
      deletions: number;
      files: number;
    }>(`workspace:diff-changed:${workspace.id}`, (event) => {
      if (!cancelled) setDiffStats(event.payload);
    });

    // Start the backend file watcher (no-op if already running)
    watchWorkspace(workspace.id).catch(() => {
      // silently ignore — workspace may have been deleted
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
      unwatchWorkspace(workspace.id).catch(() => {});
    };
  }, [workspace.id, workspace.status]);

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        menuBtnRef.current &&
        !menuBtnRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const handleDelete = async () => {
    setShowMenu(false);
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu((v) => !v);
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

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.selected : ""}`}
      onClick={onSelect}
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <div className={styles.main}>
        <div className={styles.left}>
          <div className={styles.titleRow}>
            {workspace.kind === "repo_root" ? (
              <RepoIcon />
            ) : (
              <BranchIcon size={11} />
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
              repoRoot={repoRoot}
              currentBranch={repoBranch}
              onBranchChanged={onBranchChanged}
            />
          </div>
        )}
      {workspace.status === "initializing" && setupProgress && (
        <div className={styles.setupProgressWrap}>
          {setupProgress.total > 0 && (
            <div
              className={styles.progressBar}
              role="progressbar"
              aria-valuenow={setupProgress.current}
              aria-valuemin={0}
              aria-valuemax={setupProgress.total}
              aria-label="Setup progress"
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

      {workspace.kind !== "repo_root" && (
        <div className={styles.menuAnchor} onClick={(e) => e.stopPropagation()}>
          <button
            ref={menuBtnRef}
            className={`${styles.actionBtn} ${styles.ellipsisBtn}`}
            onClick={toggleMenu}
            title="Workspace options"
          >
            <EllipsisIcon />
          </button>
          {showMenu && (
            <div ref={menuRef} className={styles.contextMenu}>
              <button
                className={styles.contextMenuItem}
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <TrashIcon />
                {isDeleting ? "Deleting..." : "Delete workspace"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
