import type { DiscardConfirmState } from "./DiscardConfirmDialog";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ContextMenu,
  EmptyState,
  GitErrorBanner,
  GitSkeleton,
  Icons,
  useDropTarget,
  type ContextMenuItem,
  type GitErrorKind,
} from "@argus/peacock";
import { useDiffFiles } from "../../../hooks/useDiffFiles";
import { useGitObservation } from "../../../hooks/useGitObservation";
import { type DiffFile, gitIndexPath } from "../../../lib/diffParser";
import { GitError } from "../../../lib/gitError";
import {
  addToGitignore,
  gitCheckoutPaths,
  gitDiscardFile,
  gitLfsFiles,
  getUserProjectSettings,
  gitStashApply,
  gitUntrackFile,
  stageAll,
  stageFile,
  unstageAll,
  unstageFile,
  type LfsFiles,
} from "../../../lib/ipc";
import {
  openFileHistory,
  requestFocusCommit,
} from "../../../stores/gitUiStore";
import { getConfirmPreference } from "../../../stores/settingsStore";
import { CommitPanel } from "../CommitPanel";
import { FileDiffView } from "../FileDiffView";
import { ViewHeader } from "../GitView/ViewHeader";
import { useGitShortcuts } from "../GitView/useGitShortcuts";
import styles from "./DiffViewer.module.css";
import { DiscardConfirmDialog } from "./DiscardConfirmDialog";
import { LfsBanners } from "./LfsBanners";
import { DiffToolbar } from "./panes/DiffToolbar";
import { UnifiedFileList } from "./panes/UnifiedFileList";
import { buildFileContextMenu } from "./panes/buildFileContextMenu";

interface DiffViewerProps {
  baseBranch?: string | null;
  branchName?: string;
  onFileCountChange?: (count: number) => void;
  /** Open the publish-branch confirm (when there's no upstream). */
  onPublishBranch?: () => void;
  /** Open the rename-branch dialog (lifted to GitView so the toolbar can trigger it). */
  onRenameBranch?: () => void;
  repoRoot: string;
  /** Filter query lifted to GitView so the unified toolbar drives it. */
  searchQuery: string;
  sessionId: string;
}

/**
 * Working-copy view — three-pane layout (Unstaged · Staged · Diff detail).
 *
 * - Each pane owns its own selection set and drag source.
 * - The pane currently holding focus (or last clicked) is the "active" pane;
 *   its selection drives the diff detail and shortcuts.
 * - Drag from one pane to the other to stage/unstage.
 */
export function DiffViewer({
  sessionId,
  baseBranch,
  branchName,
  repoRoot,
  searchQuery,
  onFileCountChange,
  onRenameBranch,
  onPublishBranch,
}: DiffViewerProps) {
  const {
    files,
    conflictFiles,
    isLoading,
    error: fetchError,
    refetch: fetchDiff,
  } = useDiffFiles(sessionId);
  const { status: gitStatus } = useGitObservation(sessionId);
  const [lfs, setLfs] = useState<LfsFiles | null>(null);
  const [suppressLfsWarning, setSuppressLfsWarning] = useState(false);
  useEffect(() => {
    let cancelled = false;
    gitLfsFiles(sessionId)
      .then((r) => {
        if (!cancelled) {
          setLfs(r);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [sessionId]);
  useEffect(() => {
    let cancelled = false;
    getUserProjectSettings(repoRoot)
      .then((s) => {
        if (!cancelled) {
          setSuppressLfsWarning(s.suppress_lfs_warning === true);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [repoRoot]);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    kind: GitErrorKind;
    message: string;
    recovery?: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    pane: "staged" | "unstaged";
    paths: string[];
    x: number;
    y: number;
  } | null>(null);
  const [confirmState, setConfirmState] = useState<DiscardConfirmState | null>(
    null,
  );

  const conflictSet = useMemo(() => new Set(conflictFiles), [conflictFiles]);

  // Report file count to parent (skip zero during initial load to avoid badge flicker)
  useEffect(() => {
    if (!isLoading || files.length > 0) {
      onFileCountChange?.(files.length);
    }
  }, [files.length, isLoading, onFileCountChange]);

  // Auto-pick a highlight when no file is selected.
  // Done at render-time (not in an effect) per React 19 guidance.
  const stillExists =
    highlighted !== null && files.some((f) => gitIndexPath(f) === highlighted);
  if (!stillExists) {
    const next = files[0] ? gitIndexPath(files[0]) : null;
    if (next !== highlighted) {
      setHighlighted(next);
    }
  }

  const handleAction = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
        await fetchDiff();
      } catch (err) {
        if (err instanceof GitError) {
          setActionError({
            kind: err.kind,
            message: err.message,
            recovery: err.recovery,
          });
        } else {
          setActionError({
            kind: "unknown",
            message: err instanceof Error ? err.message : "Operation failed",
          });
        }
      }
    },
    [fetchDiff],
  );

  const handleStageAll = useCallback(async () => {
    await stageAll(sessionId);
  }, [sessionId]);

  const handleUnstageAll = useCallback(async () => {
    await unstageAll(sessionId);
  }, [sessionId]);

  const startDiscard = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }
      if (getConfirmPreference("discard-file")) {
        handleAction(async () => {
          for (const p of paths) {
            await gitDiscardFile(sessionId, p);
          }
        });

        return;
      }
      setConfirmState({ paths, kind: "discard" });
    },
    [handleAction, sessionId],
  );

  const startUntrack = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }
      if (getConfirmPreference("untrack-file")) {
        handleAction(async () => {
          for (const p of paths) {
            await gitUntrackFile(sessionId, p);
          }
        });

        return;
      }
      setConfirmState({ paths, kind: "untrack" });
    },
    [handleAction, sessionId],
  );

  const onContextMenu = useCallback(
    (pane: "staged" | "unstaged", path: string, x: number, y: number) => {
      setContextMenu({ pane, paths: [path], x, y });
    },
    [],
  );

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu) {
      return [];
    }

    return buildFileContextMenu({
      pane: contextMenu.pane,
      paths: contextMenu.paths,
      conflictPaths: conflictSet,
      repoRoot,
      sessionId,
      onAction: handleAction,
      onDiscard: startDiscard,
      onUntrack: startUntrack,
    });
  }, [
    contextMenu,
    conflictSet,
    repoRoot,
    sessionId,
    handleAction,
    startDiscard,
    startUntrack,
  ]);

  const allStaged = files.length > 0 && files.every((f) => f.staged === "full");
  const anyStaged = files.length > 0 && files.some((f) => f.staged !== "none");

  // Phase 3 K1 — file/hunk navigation. The diff body has `data-hunk-index`
  // anchors set by `FileDiffView`; we walk them relative to the current
  // scroll position.
  const scrollToHunk = useCallback((direction: -1 | 1) => {
    const root = document.querySelector<HTMLElement>(`.${styles.diffBody}`);
    if (!root) {
      return;
    }
    const anchors = Array.from(
      root.querySelectorAll<HTMLElement>("[data-hunk-index]"),
    );
    if (anchors.length === 0) {
      return;
    }
    const top = root.getBoundingClientRect().top;
    let nextIdx = -1;
    if (direction === 1) {
      nextIdx = anchors.findIndex(
        (a) => a.getBoundingClientRect().top - top > 8,
      );
      if (nextIdx === -1) {
        nextIdx = anchors.length - 1;
      }
    } else {
      for (let i = anchors.length - 1; i >= 0; i--) {
        if (anchors[i]!.getBoundingClientRect().top - top < -8) {
          nextIdx = i;
          break;
        }
      }
      if (nextIdx === -1) {
        nextIdx = 0;
      }
    }
    anchors[nextIdx]?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const moveFile = useCallback(
    (direction: -1 | 1) => {
      if (files.length === 0) {
        return;
      }
      const paths = files.map(gitIndexPath);
      const currentIdx = highlighted ? paths.indexOf(highlighted) : -1;
      const nextIdx = Math.max(
        0,
        Math.min(paths.length - 1, currentIdx + direction),
      );
      const nextPath = paths[nextIdx];
      if (!nextPath) {
        return;
      }
      setHighlighted(nextPath);
    },
    [files, highlighted],
  );

  // Working-copy shortcuts.
  const shortcutHandlers = useMemo(
    () => ({
      "stage-all": () => handleAction(handleStageAll),
      "unstage-all": () => handleAction(handleUnstageAll),
      refresh: () => {
        fetchDiff().catch(() => undefined);
      },
      "focus-commit": () => requestFocusCommit(),
      "stage-selected": () => {
        if (!highlighted) {
          return;
        }
        handleAction(() => stageFile(sessionId, highlighted));
      },
      "unstage-selected": () => {
        if (!highlighted) {
          return;
        }
        handleAction(() => unstageFile(sessionId, highlighted));
      },
      "discard-selected": () => {
        if (!highlighted) {
          return;
        }
        startDiscard([highlighted]);
      },
      "discard-selected-alt": () => {
        if (!highlighted) {
          return;
        }
        startDiscard([highlighted]);
      },
      "toggle-ignore": () => {
        const path = highlighted;
        if (!path) {
          return;
        }
        handleAction(async () => {
          await addToGitignore(sessionId, path);
        });
      },
      "next-file": () => moveFile(1),
      "prev-file": () => moveFile(-1),
      "next-hunk": () => scrollToHunk(1),
      "prev-hunk": () => scrollToHunk(-1),
      "show-file-history": () => {
        if (highlighted) {
          openFileHistory(sessionId, highlighted);
        }
      },
    }),
    [
      handleAction,
      handleStageAll,
      handleUnstageAll,
      fetchDiff,
      highlighted,
      sessionId,
      startDiscard,
      moveFile,
      scrollToHunk,
    ],
  );
  useGitShortcuts("session", shortcutHandlers);
  // Note: project scope sessions live within the same shortcut listener, but
  // DiffViewer is session-only.

  if (isLoading && files.length === 0) {
    return (
      <div className={styles.container}>
        <GitSkeleton variant="file-list" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className={styles.container}>
        <GitErrorBanner kind="unknown" message={fetchError} />
      </div>
    );
  }

  // Resolve the file currently shown in the diff detail
  const highlightedFile: DiffFile | null = highlighted
    ? (files.find((f) => gitIndexPath(f) === highlighted) ?? null)
    : null;

  let diffDetailContent: ReactNode;
  if (files.length === 0) {
    diffDetailContent = (
      <EmptyState
        className={styles.emptyState}
        icon={<Icons.CheckIcon size={24} />}
        title="No changes"
      />
    );
  } else if (highlightedFile) {
    diffDetailContent = (
      <FileDiffView
        file={highlightedFile}
        sessionId={sessionId}
        onAction={handleAction}
      />
    );
  } else {
    diffDetailContent = (
      <EmptyState
        className={styles.emptyState}
        icon={<Icons.FileIcon size={32} />}
        title="No file selected"
        body="Select a file from the list to view its diff."
      />
    );
  }

  const branchLabel = gitStatus?.branch ?? branchName ?? "unknown";
  const upstreamLabel = gitStatus?.upstream ?? "No Track…";

  return (
    <div className={styles.container}>
      {actionError && (
        <GitErrorBanner
          kind={actionError.kind}
          message={actionError.message}
          recovery={actionError.recovery}
          onDismiss={() => setActionError(null)}
          onAction={(actionId) => {
            if (actionId === "retry") {
              fetchDiff().catch(() => undefined);
              setActionError(null);

              return;
            }
            if (actionId === "copy-stderr") {
              navigator.clipboard
                ?.writeText(actionError.message)
                .catch(() => undefined);

              return;
            }
            // eslint-disable-next-line no-console
            console.warn(`[git] action "${actionId}" not wired in Phase 1`);
          }}
        />
      )}

      <LfsBanners
        lfs={lfs}
        sessionId={sessionId}
        suppressLfsWarning={suppressLfsWarning}
        onClearTracked={() =>
          setLfs((prev) => (prev ? { ...prev, tracked: [] } : prev))
        }
        onClear={() => setLfs(null)}
      />

      {conflictFiles.length > 0 && baseBranch && (
        <div className={styles.conflictBanner}>
          {conflictFiles.length}{" "}
          {conflictFiles.length === 1 ? "conflict" : "conflicts"} with{" "}
          {baseBranch}
        </div>
      )}

      <WorkingCopyDropZone
        className={styles.workingCopyLayout ?? ""}
        overClassName={styles.workingCopyLayoutDropOver ?? ""}
        sessionId={sessionId}
        onApplied={fetchDiff}
        onError={setActionError}
      >
        <div className={styles.centerCol}>
          <ViewHeader
            title={branchLabel}
            subtitle={upstreamLabel}
            onTitleClick={onRenameBranch}
            onSubtitleClick={
              gitStatus?.upstream == null ? onPublishBranch : undefined
            }
          />
          <CommitPanel
            allStaged={allStaged}
            anyStaged={anyStaged}
            sessionId={sessionId}
            onAction={handleAction}
            onCommitted={fetchDiff}
            onStageAll={handleStageAll}
            onUnstageAll={handleUnstageAll}
          />
          <UnifiedFileList
            files={files}
            highlighted={highlighted}
            sessionId={sessionId}
            searchQuery={searchQuery}
            onHighlight={(path) => {
              setHighlighted(path);
            }}
            onContextMenu={(path, x, y) =>
              onContextMenu("unstaged", path, x, y)
            }
            onStage={(path) => handleAction(() => stageFile(sessionId, path))}
            onUnstage={(path) =>
              handleAction(() => unstageFile(sessionId, path))
            }
            onDiscard={(path) => startDiscard([path])}
          />
        </div>
        <div className={styles.diffDetail}>
          <DiffToolbar />
          <div className={styles.diffBody}>{diffDetailContent}</div>
        </div>
      </WorkingCopyDropZone>

      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
        />
      )}

      <DiscardConfirmDialog
        state={confirmState}
        sessionId={sessionId}
        onAction={handleAction}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}

interface WorkingCopyDropZoneProps {
  children: ReactNode;
  className: string;
  onApplied: () => void;
  onError: (err: { kind: GitErrorKind; message: string }) => void;
  overClassName: string;
  sessionId: string;
}

/**
 * Drop target wrapping the working-copy panel. Accepts:
 *   - `stash` payload → `git stash apply <index>`
 *   - `file` payload with `sourceRef` → `git checkout <ref> -- <paths>`
 *
 * File payloads without a `sourceRef` are ignored — those are working-tree
 * drags between staged/unstaged panes and have nothing to apply.
 */
function WorkingCopyDropZone({
  children,
  className,
  onApplied,
  onError,
  overClassName,
  sessionId,
}: WorkingCopyDropZoneProps) {
  const drop = useDropTarget<
    | { index: number; kind: "stash" }
    | { kind: "file"; paths: string[]; sourceRef?: string }
  >({
    accepts: ["stash", "file"],
    label: (payload) => {
      if (payload.kind === "stash") {
        return "Apply stash to working copy";
      }
      if (!payload.sourceRef) {
        return "";
      }
      const count = payload.paths.length;

      return count === 1
        ? `Restore "${payload.paths[0]}" from ${payload.sourceRef}`
        : `Restore ${count} files from ${payload.sourceRef}`;
    },
    onDrop: async (payload) => {
      try {
        if (payload.kind === "stash") {
          await gitStashApply(sessionId, payload.index);
        } else {
          if (!payload.sourceRef || payload.paths.length === 0) {
            return;
          }
          await gitCheckoutPaths(sessionId, payload.sourceRef, payload.paths);
        }
        onApplied();
      } catch (err) {
        const e = err as { kind?: GitErrorKind; message?: string };
        onError({
          kind: e.kind ?? "unknown",
          message: e.message ?? String(err),
        });
      }
    },
  });

  const { isOver, ...handlers } = drop;

  return (
    <div
      className={`${className} ${isOver ? overClassName : ""}`}
      {...handlers}
    >
      {children}
    </div>
  );
}
