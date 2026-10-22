import type { HostId } from "../../../lib/transport/hostId";
import type { Session } from "../../../lib/types";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ContextMenu,
  type ContextMenuItem,
  HostBadge,
  Icons,
  projectAccent,
  SidebarRepoAction,
  SidebarRepoGroup,
  VolumeBadge,
} from "@argus/peacock";
import { useGitObservation } from "../../../hooks/useGitObservation";
import { useProjectSessions } from "../../../hooks/useSessions";
import { createTerminal, revealInFinder } from "../../../lib/ipc";
import { LOCAL_HOST_ID } from "../../../lib/transport/hostId";
import { isSessionReady, sessionStatusLabel } from "../../../lib/types";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useUnreadByAgent } from "../../../stores/conversationStore";
import { startNewSession } from "../../../stores/dialogStore";
import {
  reorderSessions,
  selectSession,
  useSelectedSessionId,
  useSetupProgressBySessionId,
} from "../../../stores/sessionStore";
import { useSessionIsRunning } from "../../../stores/terminalStore";
import { BranchSwitcher } from "../BranchSwitcher";
import { DeleteSessionDialog } from "../DeleteSessionDialog";
import { RenameSessionDialog } from "../RenameSessionDialog";
import { SessionCard } from "../SessionCard";
import { SetupConfigDialog } from "../SetupConfigDialog";
import styles from "./ProjectSegment.module.css";

interface ProjectSegmentProps {
  /** Machine this repo lives on. */
  hostId?: HostId;
  /** Shown as a badge when the project is not on this Mac. */
  hostLabel?: string | null;
  /** The host's socket is down — this is its last snapshot, read-only. */
  hostOffline?: boolean;
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
  hostId = LOCAL_HOST_ID,
  hostLabel,
  hostOffline,
  isCollapsed,
  onToggleCollapsed,
  onClose,
}: ProjectSegmentProps) {
  const { sessions, repoBranch, deleteSession, refresh } = useProjectSessions(
    repoRoot,
    hostId,
  );
  const selectedId = useSelectedSessionId();
  const [showConfig, setShowConfig] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
  const [sessionToRename, setSessionToRename] = useState<Session | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [dragSessionId, setDragSessionId] = useState<string | null>(null);
  const [sessionDropTarget, setSessionDropTarget] = useState<{
    id: string;
    position: "after" | "before";
  } | null>(null);

  const handleSessionDragStart =
    (sessionId: string) => (e: React.DragEvent<HTMLDivElement>) => {
      setDragSessionId(sessionId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", sessionId);
    };

  const handleSessionDragOver =
    (sessionId: string) => (e: React.DragEvent<HTMLDivElement>) => {
      if (!dragSessionId || dragSessionId === sessionId) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const position =
        e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      setSessionDropTarget((prev) =>
        prev?.id === sessionId && prev.position === position
          ? prev
          : { id: sessionId, position },
      );
    };

  const handleSessionDrop =
    (sessionId: string) => (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const from = dragSessionId;
      const target = sessionDropTarget;
      setDragSessionId(null);
      setSessionDropTarget(null);
      if (!from || from === sessionId || !target) {
        return;
      }
      reorderSessions(from, target.id, target.position);
    };

  const handleSessionDragEnd = () => {
    setDragSessionId(null);
    setSessionDropTarget(null);
  };

  const repoRootSession = sessions.find((w) => w.kind === "project_root");
  const worktrees = sessions.filter((w) => w.kind !== "project_root");
  // Derived from the sessions rather than fetched separately: they already
  // carry the verdict, and two sources would eventually disagree. The repo
  // root is deliberately excluded — it lives in the project directory, which
  // is usually still on the internal disk and perfectly usable.
  const unavailableVolume =
    worktrees.find((w) => w.availability === "unavailable")
      ?.unavailable_volume ?? null;
  const volumeLabel = unavailableVolume?.split("/").pop() ?? null;
  const isProjectSelected =
    repoRootSession != null && repoRootSession.id === selectedId;

  const openProjectHome = () => {
    if (repoRootSession) {
      selectSession(repoRootSession.id);
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const closeMenu = useCallback(() => setMenuPosition(null), []);

  const projectName = basename(repoRoot);
  const accent = projectAccent(repoRoot);
  const hasSessions = worktrees.length > 0;
  const agents = useAgentsRecord();
  const projectSessionIds = useMemo(
    () => new Set(sessions.map((s) => s.id)),
    [sessions],
  );
  const hasRunningAgent = useMemo(
    () =>
      Object.values(agents).some(
        (a) => a.status === "running" && projectSessionIds.has(a.session_id),
      ),
    [agents, projectSessionIds],
  );
  const unreadByAgent = useUnreadByAgent();
  const hasUnread = useMemo(
    () =>
      Object.values(agents).some(
        (a) =>
          projectSessionIds.has(a.session_id) &&
          (unreadByAgent[a.agent_id]?.size ?? 0) > 0,
      ),
    [agents, projectSessionIds, unreadByAgent],
  );
  const isRunCommandRunning = useSessionIsRunning(repoRootSession?.id ?? "");
  const claimedBranches = useMemo(
    () => new Set(worktrees.map((s) => s.branch).filter((b) => b.length > 0)),
    [worktrees],
  );

  return (
    <>
      <SidebarRepoGroup
        name={projectName}
        title={repoRoot}
        dim={unavailableVolume != null}
        expanded={!isCollapsed && hasSessions}
        hideChevron={!hasSessions}
        active={isProjectSelected}
        leading={
          isRunCommandRunning ? (
            <span
              className={styles.runningIcon}
              title="Run command is executing"
            >
              <Icons.PlayIcon size={11} />
            </span>
          ) : (
            <span
              className={hasRunningAgent ? styles.folderPulse : undefined}
              style={{ color: accent, display: "inline-flex" }}
            >
              <Icons.FolderIcon size={11} />
            </span>
          )
        }
        onToggleExpanded={hasSessions ? onToggleCollapsed : undefined}
        onHeaderClick={openProjectHome}
        onHeaderContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuPosition({ x: e.clientX, y: e.clientY });
        }}
        meta={
          <>
            {hasUnread && (
              <span
                aria-label="Unread messages"
                className={styles.unreadDot}
                title="Unread agent messages"
              />
            )}
            {hostLabel && (
              <HostBadge
                label={hostLabel}
                state={hostOffline ? "offline" : "connected"}
              />
            )}
            {volumeLabel && (
              <VolumeBadge label={volumeLabel} state="unavailable" />
            )}
            {repoRootSession && <RepoHeaderMeta session={repoRootSession} />}
          </>
        }
        subtitle={
          isProjectSelected && repoBranch ? (
            <div
              className={styles.branchSwitcherSlot}
              onClick={(e) => e.stopPropagation()}
            >
              <BranchSwitcher
                claimedBranches={claimedBranches}
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
                  if (menuPosition) {
                    setMenuPosition(null);

                    return;
                  }
                  const rect = (
                    e.currentTarget as HTMLElement
                  ).getBoundingClientRect();
                  setMenuPosition({ x: rect.left, y: rect.bottom + 4 });
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
                startNewSession(repoRoot);
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
            worktrees.map((session) => {
              const isDragging = dragSessionId === session.id;
              const isTarget = sessionDropTarget?.id === session.id;
              const slotClass = [
                styles.sessionSlot,
                isDragging ? styles.sessionSlotDragging : "",
                isTarget && sessionDropTarget?.position === "before"
                  ? styles.sessionSlotDropBefore
                  : "",
                isTarget && sessionDropTarget?.position === "after"
                  ? styles.sessionSlotDropAfter
                  : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <div
                  key={session.id}
                  className={slotClass}
                  draggable
                  onDragStart={handleSessionDragStart(session.id)}
                  onDragOver={handleSessionDragOver(session.id)}
                  onDrop={handleSessionDrop(session.id)}
                  onDragEnd={handleSessionDragEnd}
                >
                  <SessionCard
                    isSelected={session.id === selectedId}
                    session={session}
                    onDelete={async () => setSessionToDelete(session)}
                    onRename={() => setSessionToRename(session)}
                    onSelect={() => selectSession(session.id)}
                  />
                </div>
              );
            })
          )}
        </div>
        <button
          className={styles.newSessionBtn}
          onClick={() => startNewSession(repoRoot)}
        >
          <Icons.PlusIcon size={10} />
          <span>New session</span>
        </button>
      </SidebarRepoGroup>

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

      {sessionToRename &&
        createPortal(
          <RenameSessionDialog
            session={sessionToRename}
            onClose={() => setSessionToRename(null)}
          />,
          document.body,
        )}
    </>
  );
}

function RepoHeaderMeta({ session }: { session: Session }) {
  const { diffStats, status } = useGitObservation(session.id, {
    enabled: isSessionReady(session.status),
  });

  const hasLineChanges = Boolean(
    diffStats && (diffStats.additions > 0 || diffStats.deletions > 0),
  );
  // Only project_root sessions surface remote-tracking ahead/behind here; for
  // worktree sessions the SourceSidebar already renders their own counters.
  const showSync =
    session.kind === "project_root" &&
    status?.upstream != null &&
    ((status.ahead ?? 0) > 0 || (status.behind ?? 0) > 0);

  if (!hasLineChanges && !showSync) {
    return null;
  }

  return (
    <>
      {hasLineChanges && diffStats && (
        <span className={styles.diffStats}>
          {diffStats.additions > 0 && (
            <span className={styles.diffAdd}>+{diffStats.additions}</span>
          )}
          {diffStats.deletions > 0 && (
            <span className={styles.diffRemove}>-{diffStats.deletions}</span>
          )}
        </span>
      )}
      {showSync && status && (
        <span
          className={`${styles.syncBadge} ${
            status.behind > 0 ? styles.syncBadgeBehind : ""
          }`}
          title={
            status.behind > 0
              ? `Behind ${status.upstream} by ${status.behind} commit${status.behind === 1 ? "" : "s"} — pull to update`
              : `Ahead of ${status.upstream} by ${status.ahead} commit${status.ahead === 1 ? "" : "s"}`
          }
        >
          {status.behind > 0 && (
            <span className={styles.syncCount}>
              <span className={styles.syncArrow}>↓</span>
              {status.behind}
            </span>
          )}
          {status.ahead > 0 && (
            <span className={styles.syncCount}>
              <span className={styles.syncArrow}>↑</span>
              {status.ahead}
            </span>
          )}
        </span>
      )}
    </>
  );
}

function RepoHeaderStatus({ session }: { session: Session }) {
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

  if (!showStatusBadge) {
    return null;
  }

  return (
    <span
      className={`${styles.statusBadge} ${styles[`ws_${statusLabel}`]}`}
      title={title}
    >
      {statusLabel}
    </span>
  );
}
