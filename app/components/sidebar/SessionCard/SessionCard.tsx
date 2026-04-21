import { useCallback, useMemo, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import { ContextMenu, type ContextMenuItem } from "@argus/peacock";
import { useSessionDiffStats } from "../../../hooks/useSessionDiffStats";
import { createTerminal, revealInFinder } from "../../../lib/ipc";
import { type Session, sessionStatusLabel } from "../../../lib/types";
import { useAgentsRecord } from "../../../stores/agentStore";
import { setActiveOrgTask, useOrgTasks } from "../../../stores/orgTaskStore";
import { useReviewQueueMap } from "../../../stores/reviewQueueStore";
import { useSetupProgressBySessionId } from "../../../stores/sessionStore";
import { useSessionIsRunning } from "../../../stores/terminalStore";
import { BranchSwitcher } from "../BranchSwitcher";
import styles from "./SessionCard.module.css";

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

interface SessionCardProps {
  isSelected: boolean;
  onBranchChanged?: () => void;
  onDelete: () => Promise<void>;
  onSelect: () => void;
  repoBasename?: string;
  repoBranch?: string | null;
  repoRoot?: string;
  session: Session;
}

function renderSessionIcon(
  kind: Session["kind"],
  isRunning: boolean,
  runningIconClass: string,
) {
  if (kind === "project_root") {
    return <Icons.RepoIcon size={13} />;
  }
  if (isRunning) {
    return (
      <span className={runningIconClass} title="Run command is executing">
        <Icons.PlayIcon size={13} />
      </span>
    );
  }

  return <Icons.BranchIcon size={13} />;
}

export function SessionCard({
  session,
  repoBasename,
  isSelected,
  onSelect,
  onDelete,
  repoRoot,
  repoBranch,
  onBranchChanged,
}: SessionCardProps) {
  const isRepoRoot = session.kind === "project_root";
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuPosition, setMenuPosition] = useState<
    "anchor" | { x: number; y: number } | null
  >(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const setupProgressById = useSetupProgressBySessionId();
  const setupProgress = setupProgressById[session.id];
  const reviewQueue = useReviewQueueMap();
  const commitsAhead = reviewQueue[session.id]?.commitsAhead ?? 0;
  const agents = useAgentsRecord();
  const runningCount = useMemo(
    () =>
      Object.values(agents).filter(
        (a) => a.session_id === session.id && a.status === "running",
      ).length,
    [agents, session.id],
  );

  const diffStats = useSessionDiffStats(session.id, session.status);
  const isRunning = useSessionIsRunning(session.id);
  const orgTasks = useOrgTasks();
  const orgTask = session.organization_task_id
    ? orgTasks.find((t) => t.id === session.organization_task_id)
    : null;

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
    repoBasename ?? repoBasenameFromPath(session.repo_root);
  const projectName = isRepoRoot
    ? effectiveRepoBasename
    : (session.display_name ?? session.branch);
  const branchName = isRepoRoot
    ? (repoBranch ?? session.branch)
    : session.branch;
  const statusLabel = sessionStatusLabel(session.status);
  const showStatusBadge = statusLabel !== "ready";
  const isDeletingStatus = session.status === "deleting";
  const errorMessage =
    typeof session.status === "object" && "error" in session.status
      ? session.status.error
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
            {renderSessionIcon(session.kind, isRunning, styles.runningIcon)}
            <span className={styles.projectName}>{projectName}</span>
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
          {!isRepoRoot && (
            <span className={styles.subtitleTrailing}>
              {!isDeletingStatus && diffStats && diffStats.files > 0 && (
                <span className={styles.diffStats}>
                  <span className={styles.diffFileCount}>
                    {diffStats.files}f
                  </span>
                  {diffStats.additions > 0 && (
                    <span className={styles.diffAdd}>
                      +{diffStats.additions}
                    </span>
                  )}
                  {diffStats.deletions > 0 && (
                    <span className={styles.diffRemove}>
                      -{diffStats.deletions}
                    </span>
                  )}
                </span>
              )}
              {!isDeletingStatus && commitsAhead > 0 && (
                <span
                  className={styles.aheadBadge}
                  title={
                    session.base_branch
                      ? `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} ahead of ${session.base_branch}`
                      : `${commitsAhead} unmerged commit${commitsAhead === 1 ? "" : "s"}`
                  }
                >
                  ↑{commitsAhead}
                </span>
              )}
              <span
                className={styles.menuAnchor}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  ref={menuBtnRef}
                  className={`${styles.actionBtn} ${styles.ellipsisBtn}`}
                  title="Session options"
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
                          onClick: () =>
                            navigator.clipboard.writeText(session.path),
                        },
                        {
                          icon: <Icons.CopyIcon size={12} />,
                          label: "Copy Relative Path",
                          onClick: () =>
                            navigator.clipboard.writeText(
                              toTildePath(session.path),
                            ),
                        },
                        {
                          icon: <Icons.BranchIcon size={12} />,
                          label: "Copy Branch Name",
                          onClick: () =>
                            navigator.clipboard.writeText(branchName),
                        },
                        { separator: true },
                        {
                          icon: <Icons.FolderIcon size={12} />,
                          label: "Reveal in Finder",
                          onClick: () => revealInFinder(session.path),
                        },
                        {
                          icon: <Icons.TerminalIcon size={12} />,
                          label: "Open in Terminal",
                          onClick: () => {
                            createTerminal(session.id);
                          },
                        },
                        { separator: true as const },
                        {
                          icon: <Icons.TrashIcon size={12} />,
                          label: isDeleting ? "Deleting..." : "Delete Session",
                          onClick: handleDelete,
                          danger: true,
                          disabled: isDeleting,
                        },
                      ] satisfies ContextMenuItem[]
                    }
                    position={menuPosition}
                    onClose={closeMenu}
                  />
                )}
              </span>
            </span>
          )}
        </div>
      </div>
      {orgTask && (
        <button
          type="button"
          className={styles.orgTaskPill}
          title={`Part of task: ${orgTask.title}`}
          onClick={(e) => {
            e.stopPropagation();
            setActiveOrgTask(orgTask.id);
          }}
        >
          task: {orgTask.title}
        </button>
      )}
      {isRepoRoot && (
        <div className={styles.subtitleRow}>
          <span className={styles.branchSubtitle}>
            {branchName}
            {session.description && (
              <span className={styles.descriptionInline}>
                {" "}
                &mdash; {session.description}
              </span>
            )}
          </span>
          <span className={styles.subtitleTrailing}>
            <span
              className={styles.menuAnchor}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                ref={menuBtnRef}
                className={`${styles.actionBtn} ${styles.ellipsisBtn}`}
                title="Session options"
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
                        onClick: () =>
                          navigator.clipboard.writeText(session.path),
                      },
                      {
                        icon: <Icons.CopyIcon size={12} />,
                        label: "Copy Relative Path",
                        onClick: () =>
                          navigator.clipboard.writeText(
                            toTildePath(session.path),
                          ),
                      },
                      {
                        icon: <Icons.BranchIcon size={12} />,
                        label: "Copy Branch Name",
                        onClick: () =>
                          navigator.clipboard.writeText(branchName),
                      },
                      { separator: true },
                      {
                        icon: <Icons.FolderIcon size={12} />,
                        label: "Reveal in Finder",
                        onClick: () => revealInFinder(session.path),
                      },
                      {
                        icon: <Icons.TerminalIcon size={12} />,
                        label: "Open in Terminal",
                        onClick: () => {
                          createTerminal(session.id);
                        },
                      },
                    ] satisfies ContextMenuItem[]
                  }
                  position={menuPosition}
                  onClose={closeMenu}
                />
              )}
            </span>
          </span>
        </div>
      )}
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
      {session.status === "initializing" && setupProgress && (
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
    </div>
  );
}
