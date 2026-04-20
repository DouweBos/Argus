import type { Session } from "../../../lib/types";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ContextMenu,
  type ContextMenuItem,
  Icons,
  SidebarRepoAction,
  SidebarRepoGroup,
} from "@argus/peacock";
import { useSessionDiffStats } from "../../../hooks/useSessionDiffStats";
import { useProjectSessions } from "../../../hooks/useSessions";
import { createTerminal, revealInFinder } from "../../../lib/ipc";
import { sessionStatusLabel } from "../../../lib/types";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useReviewQueueMap } from "../../../stores/reviewQueueStore";
import {
  selectSession,
  useSelectedSessionId,
  useSetupProgressBySessionId,
} from "../../../stores/sessionStore";
import { BranchSwitcher } from "../BranchSwitcher";
import { CreateSessionDialog } from "../CreateSessionDialog";
import { DeleteSessionDialog } from "../DeleteSessionDialog";
import { SessionCard } from "../SessionCard";
import { SetupConfigDialog } from "../SetupConfigDialog";
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
  const { sessions, repoBranch, deleteSession, refresh } =
    useProjectSessions(repoRoot);
  const selectedId = useSelectedSessionId();
  const [showCreate, setShowCreate] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
  const [menuPosition, setMenuPosition] = useState<
    "anchor" | { x: number; y: number } | null
  >(null);

  const repoRootSession = sessions.find((w) => w.kind === "project_root");
  const worktrees = sessions.filter((w) => w.kind !== "project_root");
  const isRepoHomeSelected =
    repoRootSession != null && repoRootSession.id === selectedId;

  const openProjectHome = () => {
    if (repoRootSession) {
      selectSession(repoRootSession.id);
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
      meta={repoRootSession && <RepoHeaderMeta session={repoRootSession} />}
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
          <span className={styles.branchSubtitle}>
            <Icons.BranchIcon size={11} />
            <span>{repoBranch ?? repoRootSession?.branch}</span>
          </span>
        )
      }
      endContent={
        repoRootSession && <RepoHeaderStatus session={repoRootSession} />
      }
      persistentAction={
        repoRootSession && (
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
                        navigator.clipboard.writeText(repoRootSession.path),
                    },
                    {
                      icon: <Icons.CopyIcon size={12} />,
                      label: "Copy Relative Path",
                      onClick: () =>
                        navigator.clipboard.writeText(
                          toTildePath(repoRootSession.path),
                        ),
                    },
                    {
                      icon: <Icons.BranchIcon size={12} />,
                      label: "Copy Branch Name",
                      onClick: () =>
                        navigator.clipboard.writeText(
                          repoBranch ?? repoRootSession.branch,
                        ),
                    },
                    { separator: true },
                    {
                      icon: <Icons.FolderIcon size={12} />,
                      label: "Reveal in Finder",
                      onClick: () => revealInFinder(repoRootSession.path),
                    },
                    {
                      icon: <Icons.TerminalIcon size={12} />,
                      label: "Open in Terminal",
                      onClick: () => {
                        createTerminal(repoRootSession.id);
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
            title="New session"
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
      <div aria-label="Sessions" className={styles.list} role="listbox">
        {worktrees.length === 0 ? (
          <p className={styles.emptyHint}>No sessions yet.</p>
        ) : (
          worktrees.map((session) => (
            <SessionCard
              key={session.id}
              isSelected={session.id === selectedId}
              session={session}
              onDelete={async () => setSessionToDelete(session)}
              onSelect={() => selectSession(session.id)}
            />
          ))
        )}
      </div>
      <button
        className={styles.newSessionBtn}
        onClick={() => setShowCreate(true)}
      >
        <Icons.PlusIcon size={10} />
        <span>New session</span>
      </button>

      {showCreate &&
        createPortal(
          <CreateSessionDialog
            repoRoot={repoRoot}
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

      {sessionToDelete &&
        createPortal(
          <DeleteSessionDialog
            session={sessionToDelete}
            onClose={() => setSessionToDelete(null)}
            onConfirm={async (deleteBranch) => {
              await deleteSession(sessionToDelete.id, deleteBranch);
            }}
          />,
          document.body,
        )}
    </SidebarRepoGroup>
  );
}

function RepoHeaderMeta({ session }: { session: Session }) {
  const diffStats = useSessionDiffStats(session.id, session.status);
  const reviewQueue = useReviewQueueMap();
  const commitsAhead = reviewQueue[session.id]?.commitsAhead ?? 0;

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
            session.base_branch
              ? `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} ahead of ${session.base_branch}`
              : `${commitsAhead} unmerged commit${commitsAhead === 1 ? "" : "s"}`
          }
        >
          ↑{commitsAhead}
        </span>
      )}
    </>
  );
}

function RepoHeaderStatus({ session }: { session: Session }) {
  const agents = useAgentsRecord();
  const runningCount = useMemo(
    () =>
      Object.values(agents).filter(
        (a) => a.session_id === session.id && a.status === "running",
      ).length,
    [agents, session.id],
  );
  const setupProgressById = useSetupProgressBySessionId();
  const setupProgress = setupProgressById[session.id];
  const statusLabel = sessionStatusLabel(session.status);
  const showStatusBadge = statusLabel !== "ready";
  const errorMessage =
    typeof session.status === "object" && "error" in session.status
      ? session.status.error
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
