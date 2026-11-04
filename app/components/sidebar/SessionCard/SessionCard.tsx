import type { BadgeTone } from "@argus/peacock";
import type { ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import {
  ContextMenu,
  type ContextMenuItem,
  SessionCard as PeacockSessionCard,
} from "@argus/peacock";
import { useGitObservation } from "../../../hooks/useGitObservation";
import {
  createTerminal,
  openExternalUrl,
  revealInFinder,
} from "../../../lib/ipc";
import { truncateStart } from "../../../lib/sessionProgress";
import { openSessionTab } from "../../../lib/tabActions";
import {
  isSessionReady,
  type Session,
  sessionStatusLabel,
} from "../../../lib/types";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useUnreadByAgent } from "../../../stores/conversationStore";
import { useSetupProgressBySessionId } from "../../../stores/sessionStore";
import { useSessionIsRunning } from "../../../stores/terminalStore";
import { BranchSwitcher } from "../BranchSwitcher";
import styles from "./SessionCard.module.css";
import { SessionProgress } from "./SessionProgress";

const MAX_SUBTITLE_LEN = 36;
const EMPTY_CLAIMED_BRANCHES: ReadonlySet<string> = new Set();

function repoBasenameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function toTildePath(absPath: string): string {
  const match = absPath.match(/^(\/(?:Users|home)\/[^/]+)/);

  return match ? absPath.replace(match[1], "~") : absPath;
}

interface SessionCardProps {
  /** Override the default branch/repo icon. */
  iconOverride?: ReactNode;
  isSelected: boolean;
  onBranchChanged?: () => void;
  onDelete: () => Promise<void>;
  onRename?: () => void;
  onSelect: () => void;
  repoBasename?: string;
  repoBranch?: string | null;
  repoRoot?: string;
  session: Session;
}

function kindIcon(kind: Session["kind"]): ReactNode {
  if (kind === "project_root") {
    return <Icons.RepoIcon size={13} />;
  }
  if (kind === "scratch_pad") {
    return <Icons.ScratchPadIcon size={13} />;
  }

  return <Icons.BranchIcon size={13} />;
}

/** Pick the icon node + whether it pulses green (Peacock wraps the pulse). */
function resolveSessionIcon(
  kind: Session["kind"],
  isRunning: boolean,
  isAgentRunning: boolean,
  runningCount: number,
  iconOverride?: ReactNode,
): { node: ReactNode; pulse: boolean; title?: string } {
  const base = iconOverride ?? kindIcon(kind);
  const agentTitle = `${runningCount} agent${runningCount > 1 ? "s" : ""} running`;

  if (kind === "project_root") {
    return isAgentRunning
      ? { node: base, pulse: true, title: agentTitle }
      : { node: base, pulse: false };
  }
  if (isRunning) {
    return {
      node: iconOverride ?? <Icons.PlayIcon size={13} />,
      pulse: true,
      title: isAgentRunning
        ? `${agentTitle}; run command is executing`
        : "Run command is executing",
    };
  }
  if (isAgentRunning) {
    return { node: base, pulse: true, title: agentTitle };
  }

  return { node: base, pulse: false };
}

export function SessionCard({
  session,
  repoBasename,
  isSelected,
  onSelect,
  onDelete,
  onRename,
  repoRoot,
  repoBranch,
  onBranchChanged,
  iconOverride,
}: SessionCardProps) {
  const isProject = session.kind === "project_root";
  // Not a checkout: nothing to diff, no branch to copy.
  const isScratchPad = session.kind === "scratch_pad";
  const noun = isScratchPad ? "Scratch Pad" : "Session";
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const setupProgressById = useSetupProgressBySessionId();
  const setupProgress = setupProgressById[session.id];
  const agents = useAgentsRecord();
  const unreadByAgent = useUnreadByAgent();
  const runningCount = useMemo(
    () =>
      Object.values(agents).filter(
        (a) => a.session_id === session.id && a.status === "running",
      ).length,
    [agents, session.id],
  );
  const hasUnread = useMemo(
    () =>
      Object.values(agents).some(
        (a) =>
          a.session_id === session.id &&
          (unreadByAgent[a.agent_id]?.size ?? 0) > 0,
      ),
    [agents, session.id, unreadByAgent],
  );

  // Nothing to observe on a disconnected drive, and every git call against
  // the missing path would fail.
  // Orthogonal to status: the session may be perfectly healthy and simply
  // sitting on a drive that is not plugged in.
  const isUnavailable = session.availability === "unavailable";
  const unavailableTitle = `${
    session.unavailable_volume?.split("/").pop() ??
    "The drive holding this session"
  } isn't connected — showing the last known state`;

  const { diffStats } = useGitObservation(session.id, {
    enabled: isSessionReady(session.status) && !isUnavailable && !isScratchPad,
  });
  const isRunning = useSessionIsRunning(session.id);
  const closeMenu = useCallback(() => setMenuPosition(null), []);

  // Cmd-click opens the session in its own tab, as a browser would.
  const handleSelect = useCallback(
    (event?: React.MouseEvent<HTMLElement>) => {
      if (isUnavailable) {
        return;
      }
      if (event?.metaKey || event?.ctrlKey) {
        openSessionTab(session.id, session.display_name ?? session.branch);

        return;
      }
      onSelect();
    },
    [isUnavailable, onSelect, session.id, session.display_name, session.branch],
  );

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
    if (menuPosition) {
      setMenuPosition(null);

      return;
    }
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (!rect) {
      setMenuPosition({ x: e.clientX, y: e.clientY });

      return;
    }
    // Right-align the menu with the trigger; ContextMenu clamps to viewport.
    setMenuPosition({ x: rect.right - 200, y: rect.bottom + 4 });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const effectiveRepoBasename =
    repoBasename ?? repoBasenameFromPath(session.repo_root);
  const projectName = isProject
    ? effectiveRepoBasename
    : (session.display_name ?? session.branch);
  const branchName = isProject
    ? (repoBranch ?? session.branch)
    : session.branch;
  const statusLabel = sessionStatusLabel(session.status);
  const showStatusBadge = statusLabel !== "ready" || isUnavailable;
  const isDeletingStatus = session.status === "deleting";
  const errorMessage =
    typeof session.status === "object" && "error" in session.status
      ? session.status.error
      : null;

  const pullRequest = session.pull_request;
  const iconInfo = resolveSessionIcon(
    session.kind,
    isRunning,
    runningCount > 0,
    runningCount,
    iconOverride,
  );
  const statusTone: BadgeTone =
    statusLabel === "initializing" ? "warning" : "error";
  const showDiff =
    !isProject &&
    !isDeletingStatus &&
    !isUnavailable &&
    Boolean(diffStats) &&
    (diffStats!.additions > 0 || diffStats!.deletions > 0);

  const copyItems: ContextMenuItem[] = [
    // Everything that needs the files is dropped while the drive is out; the
    // copy items still work, and are how you find out where it went.
    ...(isUnavailable
      ? []
      : [
          {
            icon: <Icons.PlusIcon size={12} />,
            label: "Open in New Tab",
            onClick: () => openSessionTab(session.id, projectName),
          },
          { separator: true } as ContextMenuItem,
        ]),
    {
      icon: <Icons.CopyIcon size={12} />,
      label: "Copy Absolute Path",
      onClick: () => navigator.clipboard.writeText(session.path),
    },
    {
      icon: <Icons.CopyIcon size={12} />,
      label: "Copy Relative Path",
      onClick: () => navigator.clipboard.writeText(toTildePath(session.path)),
    },
    ...(isScratchPad
      ? []
      : [
          {
            icon: <Icons.BranchIcon size={12} />,
            label: "Copy Branch Name",
            onClick: () => navigator.clipboard.writeText(branchName),
          },
        ]),
    ...(isUnavailable
      ? []
      : [
          { separator: true } as ContextMenuItem,
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
        ]),
  ];
  const menuItems: ContextMenuItem[] = isProject
    ? copyItems
    : [
        ...copyItems,
        { separator: true },
        ...(onRename && !isUnavailable
          ? [
              {
                icon: <Icons.PencilIcon size={12} />,
                label: `Rename ${noun}`,
                onClick: onRename,
              },
            ]
          : []),
        {
          icon: <Icons.TrashIcon size={12} />,
          label: isDeleting ? "Deleting..." : `Delete ${noun}`,
          onClick: handleDelete,
          danger: true,
          // Removing a worktree git cannot reach leaves its registration
          // behind, which breaks every later git call in the repo.
          disabled: isDeleting || isUnavailable,
        },
      ];

  // A frozen badge, not the last live one: showing "ready" for a session you
  // cannot open reads as an invitation to click it.
  const statusBadge = (() => {
    if (!showStatusBadge) {
      return undefined;
    }
    if (isUnavailable) {
      return {
        label: "unavailable",
        tone: "neutral" as BadgeTone,
        title: unavailableTitle,
      };
    }

    return {
      label: statusLabel,
      tone: statusTone,
      title: errorMessage ?? undefined,
    };
  })();

  const menuSlot = (
    <span onClick={(e) => e.stopPropagation()}>
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
          items={menuItems}
          position={menuPosition}
          onClose={closeMenu}
        />
      )}
    </span>
  );

  return (
    <PeacockSessionCard
      icon={iconInfo.node}
      iconPulse={iconInfo.pulse}
      iconTitle={iconInfo.title}
      title={projectName}
      showUnread={hasUnread}
      selected={isSelected}
      interactive
      actionReveal="hover"
      onSelect={handleSelect}
      onContextMenu={handleContextMenu}
      unavailable={isUnavailable}
      unavailableTitle={unavailableTitle}
      drive={session.volume?.split(/[/\\]/).filter(Boolean).pop()}
      pullRequest={
        pullRequest
          ? {
              number: pullRequest.number,
              state: pullRequest.state,
              onOpen: () => openExternalUrl(pullRequest.url),
            }
          : undefined
      }
      status={statusBadge}
      diff={
        showDiff
          ? {
              added:
                diffStats!.additions > 0 ? diffStats!.additions : undefined,
              removed:
                diffStats!.deletions > 0 ? diffStats!.deletions : undefined,
            }
          : undefined
      }
      actions={menuSlot}
      subtitle={
        isProject ? (
          <span className={styles.branchSubtitle}>
            {branchName}
            {session.description && (
              <span className={styles.descriptionInline}>
                {" "}
                &mdash; {session.description}
              </span>
            )}
          </span>
        ) : undefined
      }
    >
      {isProject && repoRoot && repoBranch && onBranchChanged && isSelected && (
        <div className={styles.branchRow} onClick={(e) => e.stopPropagation()}>
          <BranchSwitcher
            claimedBranches={EMPTY_CLAIMED_BRANCHES}
            currentBranch={repoBranch}
            repoRoot={repoRoot}
            onBranchChanged={onBranchChanged}
          />
        </div>
      )}
      <SessionProgress session={session} />
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
    </PeacockSessionCard>
  );
}
