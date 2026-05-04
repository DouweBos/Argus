/**
 * Phase 4 — search-aware, cursor-paginated, multi-feature commit log.
 *
 * Splits responsibilities into:
 *   - `useCursorLog` — pagination + race cancellation
 *   - `HistoryFilters` — search bar + filters
 *   - `CommitContextMenu` — right-click menu (session subset + project stubs)
 *   - `CompareView` — `comparisonRange` rendering
 *   - `FileHistoryView` — `fileHistoryBySession` rendering
 *
 * Reword-tip stays here because it's tightly coupled with row-selection.
 */

import type { RebaseSingleAction } from "./CommitContextMenu";
import type { DiffFile } from "../../../lib/diffParser";
import type { RebasePlanCommit } from "../../../lib/ipc";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  BranchDialog,
  Button,
  CalloutCard,
  ContextMenu,
  DestructiveConfirm,
  GitErrorBanner,
  GitSkeleton,
  Icons,
  RebaseEditor,
  RefBadge,
  RefBadgeList,
  ResetDialog,
  type RefBadgeListItem,
  SegmentedControl,
  TagDialog,
  useDndState,
  useDraggable,
  useDropTarget,
  type BranchDialogResult,
  type GitErrorKind,
  type RebaseAction,
  type RebasePlanEntry,
  type RefType,
  type ResetDialogResult,
  type TagDialogConfirm,
} from "@argus/peacock";
import { parseDiff } from "../../../lib/diffParser";
import { GitError } from "../../../lib/gitError";
import { buildGraphLanes } from "../../../lib/gitGraph";
import {
  gitCherryPick,
  gitCreateBranch,
  gitCreateTag,
  gitGetRemotes,
  gitLog,
  gitRebaseAutosquash,
  gitRebaseInteractivePlan,
  gitRebaseInteractiveRun,
  gitReset,
  gitRevert,
  gitShowCommit,
  type GitCommit,
} from "../../../lib/ipc";
import { gravatarUrl as buildGravatarUrl } from "../../../lib/md5";
import { setGitInteractiveRebaseView } from "../../../stores/editorStore";
import {
  closeFileHistory,
  EMPTY_HISTORY_FILTERS,
  setComparisonRange,
  setHistoryFilters,
  useComparisonRange,
  useFileHistoryRequest,
  useFocusCommitHash,
  useHistoryFilters,
  type HistoryFilters as HistoryFiltersValue,
} from "../../../stores/gitUiStore";
import { ResizablePanel } from "../../layout/ResizablePanel";
import { FileDiffView } from "../FileDiffView";
import { useGitShortcuts } from "../GitView/useGitShortcuts";
import { GraphCell } from "../GraphCell";
import styles from "../HistoryView/HistoryView.module.css";
import { CommitContextMenu } from "./CommitContextMenu";
import { CompareView } from "./CompareView";
import { FileHistoryView } from "./FileHistoryView";
import { HistoryFilters } from "./HistoryFilters";
import { detectAutosquash } from "./autosquash";
import { useCursorLog } from "./useCursorLog";

const ROW_HEIGHT = 42;

interface CommitRowProps {
  children: ReactNode;
  commit: GitCommit;
  isActive: boolean;
  /** True when this commit is reachable from HEAD. Reorder DnD only operates
   *  on commits that belong to the currently checked-out branch, since
   *  interactive rebase can't move commits that aren't in HEAD's history. */
  isOnHead: boolean;
  /** True when a hash refers to a commit on HEAD. Used to gate the reorder
   *  indicator while another commit is being dragged. */
  isOtherCommitOnHead: (hash: string) => boolean;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  /** Drop a commit on the top half of this row → insert dragged commit before this one. */
  onReorderDropAbove: (sourceHash: string) => void;
  /** Drop a commit on the bottom half of this row → insert dragged commit after this one. */
  onReorderDropBelow: (sourceHash: string) => void;
  /** Called when a tag is dropped onto this row (move/create the tag here). */
  onTagDrop: (tagName: string) => void;
}

/**
 * Build a clean chip element for the browser's drag snapshot. Avoids the
 * default-drag-image behavior of capturing the whole row (which leaks the
 * row's bottom border and the surrounding chrome into the ghost).
 */
function buildCommitDragImage(subject: string): {
  element: HTMLElement;
  x: number;
  y: number;
} {
  const el = document.createElement("div");
  el.textContent = subject.length > 60 ? `${subject.slice(0, 57)}…` : subject;
  el.style.padding = "6px 10px";
  el.style.borderRadius = "999px";
  el.style.background = "var(--accent)";
  el.style.color = "var(--accent-fg)";
  el.style.font = "var(--type-ui)";
  el.style.fontWeight = "500";
  el.style.whiteSpace = "nowrap";
  el.style.boxShadow = "var(--shadow-md)";

  return { element: el, x: 12, y: 12 };
}

interface CommitChangesetFileRowProps {
  children: ReactNode;
  className: string;
  filePath: string;
  onClick: () => void;
  /** Commit hash this file belongs to. When the row is dropped on the working
   *  copy, this ref is used to restore the file. Empty string disables drag. */
  sourceRef: string;
}

/**
 * Changeset file row for a selected commit. Draggable so the working-copy
 * panel can pick up the file and restore it from this commit.
 */
function CommitChangesetFileRow({
  children,
  className,
  filePath,
  onClick,
  sourceRef,
}: CommitChangesetFileRowProps) {
  const drag = useDraggable({
    kind: "file",
    paths: [filePath],
    sourceRef: sourceRef || undefined,
  });

  return (
    <button {...drag} className={className} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * Drop intent on a commit row during a commit drag — derived from the
 * cursor's Y position relative to the row's vertical center.
 *   - `reorder-above` — cursor in the top half; insert dragged commit before this row
 *   - `reorder-below` — cursor in the bottom half; insert dragged commit after this row
 *   - `tag`           — cursor anywhere on the row while dragging a *tag* (no reorder)
 */
type CommitDropMode = "reorder-above" | "reorder-below" | "tag";

function commitDropModeForY(rect: DOMRect, clientY: number): CommitDropMode {
  const y = clientY - rect.top;

  return y < rect.height / 2 ? "reorder-above" : "reorder-below";
}

/**
 * Single commit row in the history list. The row's button is both:
 *   - drag source — carrying the commit hash (sidebar branch rows pick it up
 *     to cherry-pick / reset)
 *   - drop target — for tag drags (move/create the tag here) and for commit
 *     drags. Commit drags discriminate by cursor Y inside the row:
 *       top 8px       → reorder above this row
 *       bottom 8px*   → reorder below (last row only)
 *       middle        → squash (default) / fixup (⌥)
 */
function CommitRow({
  commit,
  isActive,
  isSelected,
  isOnHead,
  isOtherCommitOnHead,
  onClick,
  onContextMenu,
  onMouseDown,
  onReorderDropAbove,
  onReorderDropBelow,
  onTagDrop,
  children,
}: CommitRowProps) {
  const drag = useDraggable(
    {
      kind: "commit",
      hash: commit.hash,
      subject: commit.subject,
    },
    {
      dragImage: () => buildCommitDragImage(commit.subject),
    },
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hoverMode, setHoverMode] = useState<CommitDropMode | null>(null);
  const hoverModeRef = useRef<CommitDropMode | null>(null);
  const dndState = useDndState();
  useEffect(() => {
    hoverModeRef.current = hoverMode;
  }, [hoverMode]);

  const {
    onDragEnter: handleDragEnter,
    onDragOver: baseHandleDragOver,
    onDragLeave: baseHandleDragLeave,
    onDrop: handleDrop,
  } = useDropTarget<
    | { hash: string; kind: "commit"; subject: string }
    | { kind: "tag"; tagName: string }
  >({
    accepts: ["commit", "tag"],
    label: (payload) => {
      if (payload.kind === "tag") {
        return `Move tag to commit`;
      }
      if (payload.hash === commit.hash) {
        return ``;
      }
      const mode = hoverModeRef.current ?? "reorder-above";
      if (mode === "reorder-below") {
        return `Move below "${commit.subject}"`;
      }

      return `Move above "${commit.subject}"`;
    },
    onDrop: (payload) => handleCommitDrop(payload),
  });

  function handleCommitDrop(
    payload:
      | { hash: string; kind: "commit"; subject: string }
      | { kind: "tag"; tagName: string },
  ) {
    if (payload.kind === "tag") {
      onTagDrop(payload.tagName);

      return;
    }
    if (payload.hash === commit.hash) {
      return;
    }
    // Block the drop if either side isn't on the checked-out branch.
    if (!isOnHead || !isOtherCommitOnHead(payload.hash)) {
      setHoverMode(null);

      return;
    }
    const mode = hoverModeRef.current ?? "reorder-above";
    setHoverMode(null);
    if (mode === "reorder-below") {
      onReorderDropBelow(payload.hash);
    } else {
      onReorderDropAbove(payload.hash);
    }
  }

  // Pending raf-clear for hoverMode. Cleared by the next dragover so we
  // don't flicker when the browser fires dragleave/enter pairs on every
  // child boundary inside the row.
  const clearRafRef = useRef<number | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    baseHandleDragOver(e);
    if (clearRafRef.current !== null) {
      cancelAnimationFrame(clearRafRef.current);
      clearRafRef.current = null;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const active = dndState.activePayload;
    let next: CommitDropMode | null;
    if (active?.kind === "tag") {
      // Tag drags don't reorder — tinted highlight on any commit row.
      next = "tag";
    } else if (active?.kind === "commit") {
      // Reorder only when both the dragged commit AND this row are on the
      // currently checked-out branch. Interactive rebase can't move commits
      // that aren't reachable from HEAD.
      if (isOnHead && isOtherCommitOnHead(active.hash)) {
        next = commitDropModeForY(rect, e.clientY);
      } else {
        next = null;
      }
    } else {
      next = null;
    }
    if (next !== hoverModeRef.current) {
      setHoverMode(next);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    baseHandleDragLeave(e);
    // Defer clearing one frame so a re-entry from a child boundary cancels
    // the clear before it commits — otherwise the indicator flickers off
    // every time the cursor crosses an inner element.
    if (clearRafRef.current !== null) {
      cancelAnimationFrame(clearRafRef.current);
    }
    clearRafRef.current = requestAnimationFrame(() => {
      clearRafRef.current = null;
      setHoverMode(null);
    });
  };

  useEffect(() => {
    return () => {
      if (clearRafRef.current !== null) {
        cancelAnimationFrame(clearRafRef.current);
      }
    };
  }, []);

  // Visuals are driven from `hoverMode` directly. dragover repaints every
  // frame while the cursor is on the row, which is a tighter signal than
  // the framework's `isOver` (which races with child dragenter/leave).
  const showAbove = hoverMode === "reorder-above";
  const showBelow = hoverMode === "reorder-below";
  const showTagHover = hoverMode === "tag";

  const buttonClass = [
    styles.commitItem,
    isActive ? styles.commitItemActive : "",
    isSelected && !isActive ? styles.commitItemSelected : "",
    showTagHover ? styles.commitItemDropOver : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.commitRowWrap}>
      <button
        ref={buttonRef}
        {...drag}
        className={buttonClass}
        onMouseDown={onMouseDown}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {children}
      </button>
      {/* Reorder indicators rendered as siblings of the button (children of
          the relatively-positioned wrap) so they don't depend on
          pseudo-element behaviour inside <button>, which is browser-flaky. */}
      {showAbove && (
        <span
          className={`${styles.commitReorderIndicator} ${styles.commitReorderIndicatorAbove}`}
          aria-hidden="true"
        />
      )}
      {showBelow && (
        <span
          className={`${styles.commitReorderIndicator} ${styles.commitReorderIndicatorBelow}`}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

interface CommitLogViewProps {
  allBranches: boolean;
  scope?: "project" | "session";
  sessionId: string;
  showGraph?: boolean;
}

interface CommitMenuState {
  commitIndex: number;
  x: number;
  y: number;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const time = formatTime(iso);
    const tz = -d.getTimezoneOffset() / 60;
    const tzLabel = `GMT${tz >= 0 ? "+" : ""}${tz}`;

    return `${date} at ${time} ${tzLabel}`;
  } catch {
    return iso;
  }
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }

    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function statusLabel(status: string): string {
  return (
    {
      A: "added",
      D: "deleted",
      M: "modified",
      R: "renamed",
    }[status] ?? status
  );
}

function classifyRef(name: string): RefType {
  const n = name.trim();
  if (n === "HEAD" || n.startsWith("HEAD ->")) {
    return "head";
  }
  if (n.startsWith("tag:")) {
    return "tag";
  }
  if (n.includes("/")) {
    return "remote-branch";
  }

  return "local-branch";
}

function refDisplayName(name: string): string {
  return name
    .replace(/^tag:\s*/, "")
    .replace(/^HEAD ->\s*/, "")
    .trim();
}

export function CommitLogView({
  sessionId,
  allBranches,
  scope = "session",
  showGraph = true,
}: CommitLogViewProps) {
  const persistedFilters = useHistoryFilters(sessionId);
  // Reset filters whenever sessionId changes — handled by the store key, but
  // we also strip query/author etc. when allBranches differs.
  const filters = useMemo<HistoryFiltersValue>(() => {
    if (!allBranches && persistedFilters.branch === "") {
      return persistedFilters;
    }

    return persistedFilters;
  }, [persistedFilters, allBranches]);
  const onFiltersChange = useCallback(
    (next: HistoryFiltersValue) => {
      setHistoryFilters(sessionId, next);
    },
    [sessionId],
  );

  // Hash of the autosquash-set the user has dismissed (joined fixup hashes).
  // Cleared on session change and whenever the set of fixup commits changes,
  // so dismissing only suppresses the *current* set.
  const [autosquashDismissed, setAutosquashDismissed] = useState<string | null>(
    null,
  );

  // Reset filters when session id changes.
  const [prevSession, setPrevSession] = useState(sessionId);
  if (prevSession !== sessionId) {
    setPrevSession(sessionId);
    setHistoryFilters(sessionId, EMPTY_HISTORY_FILTERS);
    setAutosquashDismissed(null);
  }

  const ipcFilters = useMemo(
    () => ({
      query: filters.query || undefined,
      author: filters.author || undefined,
      since: filters.since || undefined,
      until: filters.until || undefined,
      branch: allBranches ? filters.branch || undefined : "HEAD",
      refType: filters.refType,
    }),
    [filters, allBranches],
  );

  const log = useCursorLog(sessionId, ipcFilters);
  const { commits, loading, loadingMore, hasMore, error } = log;

  const [contextMenu, setContextMenu] = useState<CommitMenuState | null>(null);
  const [shaMenu, setShaMenu] = useState<{
    sha: string;
    x: number;
    y: number;
  } | null>(null);
  const [tipHash, setTipHash] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  // Multi-select set of commit hashes. The "active" commit (whose detail is
  // shown in the right pane) is `selectedIdx`; the set always contains the
  // active commit's hash plus any extras the user added with cmd/shift-click.
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(
    () => new Set(),
  );
  // Anchor (pivot) for keyboard / shift-click range extension. Plain click,
  // cmd-click, and arrow navigation reset both pivot and head to the active
  // row. Shift-click / shift-arrow only moves the head; pivot stays put.
  const pivotIdxRef = useRef<number>(-1);
  const headIdxRef = useRef<number>(-1);
  const [squashConfirm, setSquashConfirm] = useState<{
    commits: GitCommit[];
  } | null>(null);
  const [commitDropConfirm, setCommitDropConfirm] = useState<{
    fixup: boolean;
    source: GitCommit;
    target: GitCommit;
  } | null>(null);
  const [reorderConfirm, setReorderConfirm] = useState<{
    position: "above" | "below";
    source: GitCommit;
    target: GitCommit;
  } | null>(null);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(
    () => new Set(),
  );
  const [filesViewMode, setFilesViewMode] = useState<"changeset" | "tree">(
    "changeset",
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<GitCommit | null>(null);
  const [resetDirectTarget, setResetDirectTarget] = useState<{
    commit: GitCommit;
    mode: "hard" | "mixed" | "soft";
  } | null>(null);
  const [revertTarget, setRevertTarget] = useState<GitCommit | null>(null);
  const [cherryPickTarget, setCherryPickTarget] = useState<GitCommit | null>(
    null,
  );
  const [createBranchTarget, setCreateBranchTarget] =
    useState<GitCommit | null>(null);
  const [createTagTarget, setCreateTagTarget] = useState<GitCommit | null>(
    null,
  );
  const [opBanner, setOpBanner] = useState<{
    kind: GitErrorKind;
    message: string;
  } | null>(null);
  // Set of commit hashes reachable from HEAD (the currently checked-out
  // branch). Used to gate reorder DnD — interactive rebase only operates on
  // commits in HEAD's history. Refetched whenever the visible commit list
  // changes so the gate stays accurate after any mutation.
  const [headHashes, setHeadHashes] = useState<Set<string>>(() => new Set());
  const [autosquashRunning, setAutosquashRunning] = useState(false);
  const [rebaseState, setRebaseState] = useState<{
    baseRef: string;
    commits: RebasePlanCommit[];
    initialAction: RebaseAction;
    targetHash: string;
    upstream: string;
  } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Tip + branches + remote URL. The tip refetches on every commit-list
  // refresh so it stays in sync with HEAD after any mutation.
  useEffect(() => {
    gitLog(sessionId, 1, false)
      .then((c) => setTipHash(c[0]?.hash ?? null))
      .catch(() => setTipHash(null));
  }, [sessionId, commits]);

  // Refresh the set of HEAD-reachable commit hashes whenever the visible
  // commit list changes. We fetch enough rows to cover the visible window
  // plus a small buffer; reorder DnD only matters for commits the user can
  // see in the list. In single-branch mode this is wasted work (every
  // visible commit is on HEAD by construction) but the extra `gitLog` is
  // cheap and keeps the gate uniform across modes.
  useEffect(() => {
    const limit = Math.max(commits.length, 50);
    let cancelled = false;
    gitLog(sessionId, limit, false)
      .then((cs) => {
        if (cancelled) {
          return;
        }
        setHeadHashes(new Set(cs.map((c) => c.hash)));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setHeadHashes(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, commits]);

  const isOtherCommitOnHead = useCallback(
    (hash: string) => headHashes.has(hash),
    [headHashes],
  );

  useEffect(() => {
    gitGetRemotes(sessionId)
      .then((rs) => setRemoteUrl(rs[0]?.url ?? null))
      .catch(() => setRemoteUrl(null));
  }, [sessionId]);

  // IntersectionObserver sentinel.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const list = listRef.current;
    if (!sentinel || !list) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
          log.loadMore();
        }
      },
      { root: list, rootMargin: "200px" },
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMore, loadingMore, log]);

  const comparisonRange = useComparisonRange();
  const focusCommitHash = useFocusCommitHash();
  const fileHistoryReq = useFileHistoryRequest(sessionId);

  const loadCommitDiff = useCallback(
    async (commit: GitCommit) => {
      setExpandedFiles(new Set());
      setDiffFiles([]);
      try {
        const diff = await gitShowCommit(sessionId, commit.hash);
        const parsed = diff ? parseDiff(diff) : [];
        setDiffFiles(parsed);
        if (parsed.length > 0) {
          setExpandedFiles(new Set([0]));
        }
      } catch {
        setDiffFiles([]);
      }
    },
    [sessionId],
  );

  const selectCommit = useCallback(
    async (idx: number) => {
      setSelectedIdx(idx);
      const commit = commits[idx];
      if (!commit) {
        setSelectedHashes(new Set());

        return;
      }
      setSelectedHashes(new Set([commit.hash]));
      pivotIdxRef.current = idx;
      headIdxRef.current = idx;
      await loadCommitDiff(commit);
    },
    [commits, loadCommitDiff],
  );

  const extendSelection = useCallback(
    async (idx: number, mode: "range" | "toggle") => {
      const commit = commits[idx];
      if (!commit) {
        return;
      }
      if (mode === "range") {
        let pivot = pivotIdxRef.current;
        if (pivot < 0) {
          pivot = selectedIdx >= 0 ? selectedIdx : idx;
        }
        const lo = Math.min(pivot, idx);
        const hi = Math.max(pivot, idx);
        const next = new Set<string>();
        for (let k = lo; k <= hi; k++) {
          const c = commits[k];
          if (c) {
            next.add(c.hash);
          }
        }
        setSelectedHashes(next);
        headIdxRef.current = idx;
      } else {
        const wasSelected = selectedHashes.has(commit.hash);
        const next = new Set(selectedHashes);
        if (wasSelected) {
          next.delete(commit.hash);
        } else {
          next.add(commit.hash);
        }
        setSelectedHashes(next);
        if (wasSelected) {
          // Deselect: pick a remaining hash as active (or clear if none left).
          let fallbackIdx = -1;
          if (next.size > 0) {
            for (let k = 0; k < commits.length; k++) {
              const c = commits[k];
              if (c && next.has(c.hash)) {
                fallbackIdx = k;
                break;
              }
            }
          }
          setSelectedIdx(fallbackIdx);
          pivotIdxRef.current = fallbackIdx;
          headIdxRef.current = fallbackIdx;
          const fallback = fallbackIdx >= 0 ? commits[fallbackIdx] : undefined;
          if (fallback) {
            await loadCommitDiff(fallback);
          } else {
            setDiffFiles([]);
            setExpandedFiles(new Set());
          }

          return;
        }
        pivotIdxRef.current = idx;
        headIdxRef.current = idx;
      }
      setSelectedIdx(idx);
      await loadCommitDiff(commit);
    },
    [commits, loadCommitDiff, selectedHashes, selectedIdx],
  );

  const focusCommitRow = useCallback((idx: number) => {
    const node = listRef.current?.querySelectorAll(`.${styles.commitItem}`)[
      idx
    ] as HTMLElement | undefined;
    node?.focus();
    node?.scrollIntoView({ block: "nearest" });
  }, []);

  // Arrow / shift-arrow / cmd-A — mirrors the working-copy file list. Bound to
  // the list container in capture mode so a focused commit-row button can't
  // swallow the event before we see it.
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const len = commits.length;
      if (len === 0) {
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const lastIdx = len - 1;

        if (e.shiftKey) {
          let pivot = pivotIdxRef.current;
          if (pivot < 0) {
            pivot = selectedIdx >= 0 ? selectedIdx : 0;
            pivotIdxRef.current = pivot;
          }
          let head = headIdxRef.current;
          if (head < 0) {
            head = pivot;
          }
          const newHead = Math.max(0, Math.min(head + delta, lastIdx));
          headIdxRef.current = newHead;
          const lo = Math.min(pivot, newHead);
          const hi = Math.max(pivot, newHead);
          const next = new Set<string>();
          for (let k = lo; k <= hi; k++) {
            const c = commits[k];
            if (c) {
              next.add(c.hash);
            }
          }
          setSelectedHashes(next);
          setSelectedIdx(newHead);
          const c = commits[newHead];
          if (c) {
            loadCommitDiff(c).catch(() => undefined);
          }
          focusCommitRow(newHead);
        } else {
          const cur = selectedIdx >= 0 ? selectedIdx : 0;
          const newRow = Math.max(0, Math.min(cur + delta, lastIdx));
          pivotIdxRef.current = newRow;
          headIdxRef.current = newRow;
          const c = commits[newRow];
          if (c) {
            setSelectedHashes(new Set([c.hash]));
            setSelectedIdx(newRow);
            loadCommitDiff(c).catch(() => undefined);
          }
          focusCommitRow(newRow);
        }
      } else if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "a" || e.key === "A" || e.code === "KeyA")
      ) {
        e.preventDefault();
        e.stopPropagation();
        const all = new Set(commits.map((c) => c.hash));
        setSelectedHashes(all);
        pivotIdxRef.current = 0;
        headIdxRef.current = len - 1;
      }
    };

    list.addEventListener("keydown", handleKeyDown, true);

    return () => list.removeEventListener("keydown", handleKeyDown, true);
  }, [commits, focusCommitRow, loadCommitDiff, selectedIdx]);

  // Prune hashes that are no longer in the visible commit list (filters,
  // pagination, session swap). Derived state during render — no effect needed.
  const visibleSelectedHashes = useMemo(() => {
    if (selectedHashes.size === 0) {
      return selectedHashes;
    }
    const valid = new Set(commits.map((c) => c.hash));
    let changed = false;
    const next = new Set<string>();
    for (const h of selectedHashes) {
      if (valid.has(h)) {
        next.add(h);
      } else {
        changed = true;
      }
    }

    return changed ? next : selectedHashes;
  }, [commits, selectedHashes]);

  const toggleFile = useCallback((i: number) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }

      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<number>();
    for (let i = 0; i < diffFiles.length; i++) {
      all.add(i);
    }
    setExpandedFiles(all);
  }, [diffFiles.length]);

  const graphRows = useMemo(
    () => (showGraph ? buildGraphLanes(commits) : []),
    [commits, showGraph],
  );

  // Ahead/behind sets for commits relative to the upstream tracking branch.
  // Computed by walking parents within the visible commit list from each tip;
  // commits reachable from local but not remote are "ahead", and vice versa.
  const { aheadSet, behindSet } = useMemo(() => {
    const empty = {
      aheadSet: new Set<string>(),
      behindSet: new Set<string>(),
    };
    let localBranch: string | null = null;
    let localTipHash: string | null = null;
    for (const c of commits) {
      if (!c.refs) {
        continue;
      }
      const refs = c.refs.split(",").map((r) => r.trim());
      const headRef = refs.find((r) => r.startsWith("HEAD ->"));
      if (headRef) {
        localBranch = headRef.replace(/^HEAD ->\s*/, "").trim();
        localTipHash = c.hash;
        break;
      }
    }
    if (!localBranch || !localTipHash) {
      return empty;
    }
    let remoteTipHash: string | null = null;
    for (const c of commits) {
      if (!c.refs) {
        continue;
      }
      const refs = c.refs.split(",").map((r) => r.trim());
      const remoteRef = refs.find(
        (r) =>
          !r.startsWith("HEAD") &&
          !r.startsWith("tag:") &&
          r.includes("/") &&
          r.endsWith(`/${localBranch}`),
      );
      if (remoteRef) {
        remoteTipHash = c.hash;
        break;
      }
    }
    if (!remoteTipHash || remoteTipHash === localTipHash) {
      return empty;
    }
    const byHash = new Map(commits.map((c) => [c.hash, c]));
    const walk = (start: string) => {
      const visited = new Set<string>();
      const stack = [start];
      while (stack.length > 0) {
        const h = stack.pop()!;
        if (visited.has(h)) {
          continue;
        }
        visited.add(h);
        const c = byHash.get(h);
        if (!c?.parentHash) {
          continue;
        }
        for (const p of c.parentHash.split(" ").filter(Boolean)) {
          if (!visited.has(p)) {
            stack.push(p);
          }
        }
      }

      return visited;
    };
    const localReach = walk(localTipHash);
    const remoteReach = walk(remoteTipHash);
    const ahead = new Set<string>();
    const behind = new Set<string>();
    for (const h of localReach) {
      if (!remoteReach.has(h)) {
        ahead.add(h);
      }
    }
    for (const h of remoteReach) {
      if (!localReach.has(h)) {
        behind.add(h);
      }
    }

    return { aheadSet: ahead, behindSet: behind };
  }, [commits]);

  const selected = selectedIdx >= 0 ? commits[selectedIdx] : null;

  const gravatarUrl = useMemo(
    () => buildGravatarUrl(selected?.authorEmail ?? null, 80),
    [selected],
  );

  const fileStats = useMemo(() => {
    return diffFiles.map((f) => {
      let adds = 0;
      let dels = 0;
      for (const h of f.hunks) {
        for (const l of h.lines) {
          if (l.type === "add") {
            adds++;
          } else if (l.type === "remove") {
            dels++;
          }
        }
      }

      return { adds, dels };
    });
  }, [diffFiles]);

  const totalAdds = fileStats.reduce((a, s) => a + s.adds, 0);
  const totalDels = fileStats.reduce((a, s) => a + s.dels, 0);

  // Phase 3 K3 + Phase 4 — keyboard handlers.
  const shortcutHandlers = useMemo(
    () => ({
      "copy-commit-hash": () => {
        const c = commits[selectedIdx];
        if (c) {
          navigator.clipboard?.writeText(c.hash).catch(() => undefined);
        }
      },
      "copy-commit-summary": () => {
        const c = commits[selectedIdx];
        if (c) {
          navigator.clipboard
            ?.writeText(`${c.abbreviatedHash}  ${c.subject}`)
            .catch(() => undefined);
        }
      },
      "open-commit": () => {
        if (selectedIdx >= 0) {
          selectCommit(selectedIdx);
        } else if (commits.length > 0) {
          selectCommit(0);
        }
      },
    }),
    [commits, selectedIdx, selectCommit],
  );
  useGitShortcuts(scope, shortcutHandlers);

  // Scroll requested commit into view.
  useEffect(() => {
    if (!focusCommitHash) {
      return;
    }
    const idx = commits.findIndex(
      (c) => c.hash === focusCommitHash || c.hash.startsWith(focusCommitHash),
    );
    if (idx >= 0) {
      selectCommit(idx);

      const node = listRef.current?.querySelectorAll(`.${styles.commitItem}`)[
        idx
      ];
      node?.scrollIntoView({ block: "center" });
    }
  }, [focusCommitHash, commits, selectCommit]);

  const openRebaseEditor = useCallback(
    async (commit: GitCommit, action: RebaseSingleAction) => {
      setOpBanner(null);
      try {
        // Upstream = the right-clicked commit's first parent. Use ^ syntax;
        // git resolves it to the parent SHA.
        const upstream = `${commit.hash}^`;
        const plan = await gitRebaseInteractivePlan(sessionId, { upstream });
        setRebaseState({
          baseRef: upstream,
          commits: plan,
          initialAction: action,
          targetHash: commit.hash,
          upstream,
        });
      } catch (err) {
        if (err instanceof GitError) {
          setOpBanner({ kind: err.kind, message: err.message });
        } else {
          setOpBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [sessionId],
  );

  const openInteractiveRebaseFromHere = useCallback(
    async (commit: GitCommit) => {
      setOpBanner(null);
      try {
        const upstream = `${commit.hash}^`;
        const plan = await gitRebaseInteractivePlan(sessionId, { upstream });
        setRebaseState({
          baseRef: upstream,
          commits: plan,
          initialAction: "pick",
          targetHash: commit.hash,
          upstream,
        });
      } catch (err) {
        if (err instanceof GitError) {
          setOpBanner({ kind: err.kind, message: err.message });
        } else {
          setOpBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [sessionId],
  );

  const handleCommitClick = useCallback(
    (e: React.MouseEvent, i: number) => {
      if (e.shiftKey) {
        e.preventDefault();
        extendSelection(i, "range").catch(() => undefined);
      } else if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        extendSelection(i, "toggle").catch(() => undefined);
      } else {
        selectCommit(i).catch(() => undefined);
      }
    },
    [extendSelection, selectCommit],
  );

  // Range selections via shift-click can otherwise highlight text in the row.
  const handleCommitMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
    }
  }, []);

  // Contiguous if highest-lowest === count-1 in the visible list.
  const selectedIndices = useMemo(() => {
    if (visibleSelectedHashes.size === 0) {
      return [] as number[];
    }
    const out: number[] = [];
    commits.forEach((c, i) => {
      if (visibleSelectedHashes.has(c.hash)) {
        out.push(i);
      }
    });

    return out;
  }, [commits, visibleSelectedHashes]);

  const requestSquashSelection = useCallback(() => {
    if (selectedIndices.length < 2) {
      return;
    }
    const picked = selectedIndices.map((i) => commits[i]!).filter(Boolean);
    setSquashConfirm({ commits: picked });
  }, [commits, selectedIndices]);

  const runSquashSelection = useCallback(
    async (picked: GitCommit[]) => {
      if (picked.length < 2) {
        return;
      }
      // `commits` is newest-first, so the highest index is the oldest commit.
      // Sorting by index ascending gives us newest-first order for the picked set.
      const oldest = picked[picked.length - 1]!;
      const upstream = `${oldest.hash}^`;
      try {
        const plan = await gitRebaseInteractivePlan(sessionId, { upstream });
        const selectedSet = new Set(picked.map((c) => c.hash));
        // Reorder the rebase plan so the squash works for non-contiguous
        // selections too: the oldest selected commit stays as `pick`, every
        // other selected commit follows immediately as `squash`, then the
        // unselected commits replay on top in their original order. If
        // replaying an unselected commit on top of the squashed result
        // conflicts, git halts the rebase and we surface the error.
        const selectedEntries: RebasePlanEntry[] = [];
        const unselectedEntries: RebasePlanEntry[] = [];
        for (const c of plan) {
          if (selectedSet.has(c.hash)) {
            selectedEntries.push({
              hash: c.hash,
              action: c.hash === oldest.hash ? "pick" : "squash",
            });
          } else {
            unselectedEntries.push({ hash: c.hash, action: "pick" });
          }
        }
        const planEntries: RebasePlanEntry[] = [
          ...selectedEntries,
          ...unselectedEntries,
        ];
        await gitRebaseInteractiveRun(sessionId, {
          upstream,
          plan: planEntries,
        });
        setSelectedHashes(new Set([oldest.hash]));
      } catch (err) {
        if (err instanceof GitError) {
          setOpBanner({ kind: err.kind, message: err.message });
        } else {
          setOpBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [sessionId],
  );

  // DnD: drop one commit onto another → squash (or fixup with ⌥). The dragged
  // commit is folded into the drop target's position, preserving the target's
  // place in history.
  const runCommitDropOnto = useCallback(
    async (source: GitCommit, target: GitCommit, fixup: boolean) => {
      if (source.hash === target.hash) {
        return;
      }
      const srcIdx = commits.findIndex((c) => c.hash === source.hash);
      const tgtIdx = commits.findIndex((c) => c.hash === target.hash);
      if (srcIdx < 0 || tgtIdx < 0) {
        return;
      }
      // commits[] is newest-first; the larger index is older. Upstream needs
      // to be the parent of the deepest commit in the rewritten range.
      const deepestIdx = Math.max(srcIdx, tgtIdx);
      const upstream = `${commits[deepestIdx]!.hash}^`;
      try {
        const plan = await gitRebaseInteractivePlan(sessionId, { upstream });
        const sourceEntry = plan.find((p) => p.hash === source.hash);
        const targetIdxInPlan = plan.findIndex((p) => p.hash === target.hash);
        if (!sourceEntry || targetIdxInPlan < 0) {
          setOpBanner({
            kind: "unknown",
            message: "Commit not found in rebase plan.",
          });

          return;
        }
        // Reorder: place source immediately after target in the plan
        // (oldest-first), so source folds into target with `squash`/`fixup`.
        const without = plan.filter((p) => p.hash !== source.hash);
        const newTargetIdx = without.findIndex((p) => p.hash === target.hash);
        const reordered = [
          ...without.slice(0, newTargetIdx + 1),
          sourceEntry,
          ...without.slice(newTargetIdx + 1),
        ];
        const action: RebaseAction = fixup ? "fixup" : "squash";
        const planEntries: RebasePlanEntry[] = reordered.map((c) => ({
          hash: c.hash,
          action: c.hash === source.hash ? action : "pick",
        }));
        await gitRebaseInteractiveRun(sessionId, {
          upstream,
          plan: planEntries,
        });
        setSelectedHashes(new Set([target.hash]));
      } catch (err) {
        if (err instanceof GitError) {
          setOpBanner({ kind: err.kind, message: err.message });
        } else {
          setOpBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [sessionId, commits],
  );

  // DnD: drop a commit onto a reorder strip → reorder via interactive rebase.
  // `position === "above"` inserts the source above the target (newer side);
  // "below" inserts below (older side, only available on the very last row).
  const runCommitReorder = useCallback(
    async (
      source: GitCommit,
      target: GitCommit,
      position: "above" | "below",
    ) => {
      if (source.hash === target.hash) {
        return;
      }
      const srcIdx = commits.findIndex((c) => c.hash === source.hash);
      const tgtIdx = commits.findIndex((c) => c.hash === target.hash);
      if (srcIdx < 0 || tgtIdx < 0) {
        return;
      }
      // No-op detection: dropping above the row that's already directly below
      // source, or below source itself, doesn't move anything.
      if (position === "above" && tgtIdx === srcIdx + 1) {
        return;
      }
      if (position === "above" && tgtIdx === srcIdx) {
        return;
      }
      if (position === "below" && tgtIdx === srcIdx - 1) {
        return;
      }
      const deepestIdx = Math.max(
        srcIdx,
        position === "below" ? tgtIdx : tgtIdx,
      );
      const upstream = `${commits[deepestIdx]!.hash}^`;
      try {
        const plan = await gitRebaseInteractivePlan(sessionId, { upstream });
        const sourceEntry = plan.find((p) => p.hash === source.hash);
        if (!sourceEntry) {
          setOpBanner({
            kind: "unknown",
            message: "Source commit not found in rebase plan.",
          });

          return;
        }
        const without = plan.filter((p) => p.hash !== source.hash);
        const targetIdxInWithout = without.findIndex(
          (p) => p.hash === target.hash,
        );
        if (targetIdxInWithout < 0) {
          setOpBanner({
            kind: "unknown",
            message: "Target commit not found in rebase plan.",
          });

          return;
        }
        // commits[] is newest-first while the plan is oldest-first. "Above" in
        // the visual list means newer → insert AFTER the target in the plan.
        // "Below" → insert BEFORE the target in the plan.
        const insertAt =
          position === "above" ? targetIdxInWithout + 1 : targetIdxInWithout;
        const reordered = [
          ...without.slice(0, insertAt),
          sourceEntry,
          ...without.slice(insertAt),
        ];
        const planEntries: RebasePlanEntry[] = reordered.map((c) => ({
          hash: c.hash,
          action: "pick" as RebaseAction,
        }));
        await gitRebaseInteractiveRun(sessionId, {
          upstream,
          plan: planEntries,
        });
        setSelectedHashes(new Set([source.hash]));
      } catch (err) {
        if (err instanceof GitError) {
          setOpBanner({ kind: err.kind, message: err.message });
        } else {
          setOpBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [sessionId, commits],
  );

  // Autosquash banner --------------------------------------------------------

  const autosquash = useMemo(
    () => detectAutosquash(commits, headHashes),
    [commits, headHashes],
  );
  const autosquashSignature = useMemo(() => {
    if (!autosquash) {
      return null;
    }
    const hashes: string[] = [];
    for (const c of commits) {
      if (
        headHashes.has(c.hash) &&
        /^(?:fixup|squash|amend)!\s+/.test(c.subject)
      ) {
        hashes.push(c.hash);
      }
    }

    return hashes.sort().join(",");
  }, [commits, headHashes, autosquash]);

  const handleAutosquash = useCallback(async () => {
    if (!autosquash) {
      return;
    }
    setOpBanner(null);
    const upstream = autosquash.oldestTarget.parentHash
      ? autosquash.oldestTarget.parentHash
      : `${autosquash.oldestTarget.hash}^`;
    setAutosquashRunning(true);
    try {
      await gitRebaseAutosquash(sessionId, { upstream });
    } catch (err) {
      if (err instanceof GitError) {
        setOpBanner({ kind: err.kind, message: err.message });
      } else {
        setOpBanner({
          kind: "unknown",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setAutosquashRunning(false);
    }
  }, [autosquash, sessionId]);

  // Render -----------------------------------------------------------------

  if (loading) {
    return <GitSkeleton variant="commit-log" />;
  }
  if (error) {
    return <GitErrorBanner kind="unknown" message={error} />;
  }

  // Filters are hidden by default — the design has just a small ref-scope
  // pill above the list. Click the pill to expand the full filter form.
  const filtersBar = filtersOpen ? (
    <HistoryFilters
      authors={Array.from(new Set(commits.map((c) => c.author))).sort()}
      branches={Array.from(
        new Set(
          commits.flatMap((c) =>
            c.refs ? c.refs.split(",").map((r) => refDisplayName(r)) : [],
          ),
        ),
      ).sort()}
      hideBranch={!allBranches}
      value={filters}
      onChange={onFiltersChange}
    />
  ) : null;

  // File history takes over the detail pane.
  if (fileHistoryReq) {
    return (
      <div className={styles.layoutColumn}>
        <FileHistoryView
          path={fileHistoryReq.path}
          sessionId={sessionId}
          onClose={() => closeFileHistory(sessionId)}
        />
      </div>
    );
  }

  // Compare view replaces the detail pane.
  if (comparisonRange) {
    return (
      <div className={styles.layoutColumn}>
        <CompareView
          fromRef={comparisonRange.from}
          toRef={comparisonRange.to}
          sessionId={sessionId}
        />
      </div>
    );
  }

  const refScopeLabel =
    {
      tags: "Tags",
      remotes: "Remotes",
      locals: "Local Branches",
      all: "All Branches, Remotes, Tags",
    }[filters.refType] ?? "All Branches, Remotes, Tags";

  const showAutosquash =
    autosquash !== null && autosquashDismissed !== autosquashSignature;

  return (
    <>
      <div className={styles.layoutColumn}>
        {showAutosquash && autosquash && (
          <div className={styles.autosquashBannerWrap}>
            <CalloutCard
              tone="warning"
              leading={<Icons.DownloadIcon size={16} />}
              title="Autosquash Commits"
              meta={
                autosquash.count === 1
                  ? "Found 1 fixup/squash commit that can be automatically combined with its target commit."
                  : `Found ${autosquash.count} fixup/squash commits that can be automatically combined with their target commits.`
              }
              actions={
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleAutosquash}
                    disabled={autosquashRunning}
                  >
                    {autosquashRunning ? "Autosquashing…" : "Autosquash…"}
                  </Button>
                  <button
                    type="button"
                    className={styles.autosquashDismiss}
                    aria-label="Dismiss autosquash banner"
                    onClick={() => setAutosquashDismissed(autosquashSignature)}
                  >
                    <Icons.CloseIcon size={12} />
                  </button>
                </>
              }
            />
          </div>
        )}
        <div className={styles.historyToolbar}>
          <span className={styles.historyScopeLabel}>
            <Icons.BranchIcon size={11} />
            <span>{refScopeLabel}</span>
          </span>
          <button
            type="button"
            className={styles.historyFilterButton}
            aria-label="Toggle history filters"
            aria-pressed={filtersOpen}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <Icons.SlidersIcon size={12} />
          </button>
          <span className={styles.historyToolbarSpacer} />
          <span className={styles.historyCount}>
            {commits.length.toLocaleString()} commit
            {commits.length !== 1 ? "s" : ""}
          </span>
        </div>
        {filtersBar}
        <div className={styles.bodyRow}>
          <ResizablePanel
            defaultWidth={0.4}
            maxWidth={0.6}
            minWidth={0.2}
            side="left"
          >
            <div className={styles.commitListWrap}>
              <div ref={listRef} className={styles.commitList}>
                {commits.map((commit, i) => {
                  return (
                    <CommitRow
                      key={commit.hash}
                      commit={commit}
                      isActive={i === selectedIdx}
                      isSelected={visibleSelectedHashes.has(commit.hash)}
                      isOnHead={headHashes.has(commit.hash)}
                      isOtherCommitOnHead={isOtherCommitOnHead}
                      onReorderDropAbove={(sourceHash) => {
                        const source = commits.find(
                          (c) => c.hash === sourceHash,
                        );
                        if (!source) {
                          return;
                        }
                        setReorderConfirm({
                          source,
                          target: commit,
                          position: "above",
                        });
                      }}
                      onReorderDropBelow={(sourceHash) => {
                        const source = commits.find(
                          (c) => c.hash === sourceHash,
                        );
                        if (!source) {
                          return;
                        }
                        setReorderConfirm({
                          source,
                          target: commit,
                          position: "below",
                        });
                      }}
                      onMouseDown={handleCommitMouseDown}
                      onClick={(e) => handleCommitClick(e, i)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        // Match working-copy behaviour: right-clicking a row
                        // that isn't part of the multi-selection collapses the
                        // selection back to just that row.
                        if (!visibleSelectedHashes.has(commit.hash)) {
                          selectCommit(i).catch(() => undefined);
                        }
                        setContextMenu({
                          commitIndex: i,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                      onTagDrop={(tagName) => {
                        gitCreateTag(sessionId, {
                          name: tagName,
                          ref: commit.hash,
                          force: true,
                        }).catch((err: unknown) => {
                          if (err instanceof GitError) {
                            setOpBanner({
                              kind: err.kind,
                              message: err.message,
                            });
                          }
                        });
                      }}
                    >
                      {showGraph && graphRows[i] && (
                        <GraphCell row={graphRows[i]} rowHeight={ROW_HEIGHT} />
                      )}
                      <Avatar
                        className={styles.commitAvatar}
                        name={commit.author}
                        src={buildGravatarUrl(commit.authorEmail, 48)}
                      />
                      <div className={styles.commitInfo}>
                        <div className={styles.commitTop}>
                          <span className={styles.commitSubject}>
                            {commit.subject}
                          </span>
                          {commit.refs &&
                            (() => {
                              const items: RefBadgeListItem[] = commit.refs
                                .split(",")
                                .map((raw) => raw.trim())
                                .filter((r) => r.length > 0)
                                .map((r) => {
                                  const type = classifyRef(r);

                                  return {
                                    name: refDisplayName(r),
                                    type,
                                    current: type === "head",
                                  };
                                });

                              // Short single ref → inline; everything else collapses to a tag-icon trigger.
                              const SHORT_REF_LEN = 18;
                              if (
                                items.length === 1 &&
                                items[0]!.name.length <= SHORT_REF_LEN
                              ) {
                                const only = items[0]!;

                                return (
                                  <RefBadge
                                    name={only.name}
                                    type={only.type}
                                    size="sm"
                                    current={only.current}
                                  />
                                );
                              }

                              return <RefBadgeList items={items} />;
                            })()}
                        </div>
                        <div className={styles.commitSubtitle}>
                          <span className={styles.commitAuthor}>
                            {commit.author}
                          </span>
                          <span className={styles.commitDot}>·</span>
                          <span className={styles.commitTime}>
                            {formatTime(commit.date)}
                          </span>
                        </div>
                      </div>
                      <span className={styles.commitHash}>
                        {formatShortDate(commit.date)}
                      </span>
                      {aheadSet.has(commit.hash) && (
                        <span
                          className={styles.commitSyncIndicator}
                          title="Ahead of upstream — not yet pushed"
                          aria-label="Ahead of upstream"
                        >
                          <Icons.ArrowUpRightIcon size={12} />
                        </span>
                      )}
                      {behindSet.has(commit.hash) && (
                        <span
                          className={styles.commitSyncIndicator}
                          title="Behind upstream — not yet pulled"
                          aria-label="Behind upstream"
                        >
                          <Icons.ArrowDownLeftIcon size={12} />
                        </span>
                      )}
                    </CommitRow>
                  );
                })}
                {hasMore && (
                  <div ref={sentinelRef} className={styles.loadingMore}>
                    {loadingMore ? "Loading more..." : ""}
                  </div>
                )}
                {commits.length === 0 && (
                  <div className={styles.emptyState}>No commits</div>
                )}
              </div>
            </div>
          </ResizablePanel>

          <div className={styles.detailPanel}>
            {selected ? (
              <div className={styles.detailContent}>
                <div className={styles.detailToolbar}>
                  <span className={styles.hashPill}>
                    <Avatar
                      className={styles.hashPillAvatar}
                      name={selected.author}
                      size={18}
                      src={buildGravatarUrl(selected.authorEmail, 36)}
                    />
                    <span className={styles.hashPillHash}>
                      {selected.abbreviatedHash}
                    </span>
                  </span>
                  <span className={styles.detailToolbarSpacer} />
                  <SegmentedControl
                    aria-label="File view mode"
                    size="sm"
                    options={[
                      { value: "changeset", label: "Changeset" },
                      { value: "tree", label: "Tree" },
                    ]}
                    value={filesViewMode}
                    onChange={setFilesViewMode}
                  />
                </div>

                <dl className={styles.commitMetaTable}>
                  <dt>Authored</dt>
                  <dd>{formatDateTime(selected.date)}</dd>
                  <dt>Committed</dt>
                  <dd>
                    {formatDateTime(selected.committerDate || selected.date)}
                  </dd>
                  <dt>Commit</dt>
                  <dd
                    className={styles.commitMetaMono}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setShaMenu({
                        sha: selected.hash,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  >
                    {selected.hash}
                  </dd>
                  <dt>Parent</dt>
                  <dd
                    className={styles.commitMetaMono}
                    onContextMenu={(e) => {
                      if (!selected.parentHash) {
                        return;
                      }
                      e.preventDefault();
                      setShaMenu({
                        sha: selected.parentHash,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  >
                    {selected.parentHash}
                  </dd>
                  {selected.treeHash && (
                    <>
                      <dt>Tree</dt>
                      <dd
                        className={styles.commitMetaMono}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setShaMenu({
                            sha: selected.treeHash ?? "",
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                      >
                        {selected.treeHash}
                      </dd>
                    </>
                  )}
                  {selected.refs &&
                    (() => {
                      const refs = selected.refs
                        .split(",")
                        .map((r) => r.trim())
                        .filter(Boolean);
                      if (refs.length === 0) {
                        return null;
                      }

                      return (
                        <>
                          <dt>Refs</dt>
                          <dd className={styles.commitMetaRefs}>
                            {refs.map((r) => {
                              const type = classifyRef(r);

                              return (
                                <RefBadge
                                  key={r}
                                  name={refDisplayName(r)}
                                  type={type}
                                  size="sm"
                                  current={
                                    type === "head" ||
                                    (tipHash !== null &&
                                      selected.hash === tipHash)
                                  }
                                />
                              );
                            })}
                          </dd>
                        </>
                      );
                    })()}
                </dl>

                <div className={styles.detailHeader}>
                  <h2 className={styles.detailTitle}>{selected.subject}</h2>
                  {selected.body && (
                    <pre className={styles.detailBody}>{selected.body}</pre>
                  )}
                  <div className={styles.detailAuthorRow}>
                    <Avatar
                      className={styles.detailAuthorAvatar}
                      name={selected.author}
                      src={gravatarUrl}
                    />
                    <div className={styles.detailAuthorInfo}>
                      <span className={styles.detailAuthorName}>
                        {selected.author}
                      </span>
                      <span className={styles.detailAuthorEmail}>
                        &lt;{selected.authorEmail}&gt;
                      </span>
                    </div>
                  </div>
                </div>

                <div className={styles.statsRow}>
                  <div className={styles.statBlock}>
                    <span className={styles.statNum}>{diffFiles.length}</span>
                    <span className={styles.statLabel}>
                      file{diffFiles.length !== 1 ? "s" : ""} changed
                    </span>
                  </div>
                  <div className={`${styles.statBlock} ${styles.statAdd}`}>
                    <span className={styles.statNum}>+{totalAdds}</span>
                    <span className={styles.statLabel}>additions</span>
                  </div>
                  <div className={`${styles.statBlock} ${styles.statDel}`}>
                    <span className={styles.statNum}>−{totalDels}</span>
                    <span className={styles.statLabel}>deletions</span>
                  </div>
                </div>

                <div className={styles.filesHeader}>
                  <span className={styles.filesHeaderTitle}>Changed files</span>
                  <span className={styles.detailToolbarSpacer} />
                  <Button size="sm" variant="ghost" onClick={expandAll}>
                    Expand All
                  </Button>
                  {scope === "project" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Open interactive rebase using this commit as the upstream boundary"
                      onClick={() => openInteractiveRebaseFromHere(selected)}
                    >
                      Interactive rebase from here
                    </Button>
                  )}
                </div>

                <div className={styles.filesList}>
                  {filesViewMode === "tree" ? (
                    <FileTreeList
                      diffFiles={diffFiles}
                      fileStats={fileStats}
                      expandedFiles={expandedFiles}
                      onToggle={toggleFile}
                      sessionId={sessionId}
                    />
                  ) : (
                    diffFiles.map((file, i) => {
                      const path = file.newPath || file.oldPath;
                      const isExpanded = expandedFiles.has(i);
                      const stat = fileStats[i] ?? { adds: 0, dels: 0 };

                      return (
                        <div key={`${path}-${i}`}>
                          <CommitChangesetFileRow
                            className={`${styles.fileRow} ${isExpanded ? styles.fileRowExpanded : ""}`}
                            filePath={path}
                            sourceRef={selected?.hash ?? ""}
                            onClick={() => toggleFile(i)}
                          >
                            <span className={styles.fileChevron}>
                              {isExpanded ? (
                                <Icons.ChevronDownIcon size={10} />
                              ) : (
                                <Icons.ChevronRightIcon size={8} />
                              )}
                            </span>
                            <span
                              className={`${styles.fileBadge} ${styles[`badge${file.status}`]}`}
                              title={statusLabel(file.status)}
                            >
                              {file.status}
                            </span>
                            <span className={styles.filePath}>{path}</span>
                            <span className={styles.fileStats}>
                              {stat.adds > 0 && (
                                <span className={styles.fileStatAdd}>
                                  +{stat.adds}
                                </span>
                              )}
                              {stat.dels > 0 && (
                                <span className={styles.fileStatDel}>
                                  −{stat.dels}
                                </span>
                              )}
                            </span>
                          </CommitChangesetFileRow>
                          {isExpanded && (
                            <div className={styles.fileDiffInline}>
                              <FileDiffView
                                file={file}
                                inline
                                readOnly
                                sessionId={sessionId}
                                onAction={async () => undefined}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className={styles.emptyState}>
                <Icons.FileIcon size={48} />
                <p>Select a commit to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {shaMenu && (
        <ContextMenu
          items={[
            {
              icon: <Icons.CopyIcon size={11} />,
              label: "Copy SHA",
              onClick: () => {
                navigator.clipboard
                  ?.writeText(shaMenu.sha)
                  .catch(() => undefined);
                setShaMenu(null);
              },
            },
            {
              icon: <Icons.CopyIcon size={11} />,
              label: "Copy short SHA",
              onClick: () => {
                navigator.clipboard
                  ?.writeText(shaMenu.sha.slice(0, 7))
                  .catch(() => undefined);
                setShaMenu(null);
              },
            },
          ]}
          position={{ x: shaMenu.x, y: shaMenu.y }}
          onClose={() => setShaMenu(null)}
        />
      )}

      {contextMenu && commits[contextMenu.commitIndex] && (
        <CommitContextMenu
          commit={commits[contextMenu.commitIndex]!}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          remoteUrl={remoteUrl}
          scope={scope}
          selectionCount={
            visibleSelectedHashes.has(commits[contextMenu.commitIndex]!.hash)
              ? visibleSelectedHashes.size
              : 1
          }
          onSquashSelection={
            scope === "project" && visibleSelectedHashes.size >= 2
              ? () => {
                  setContextMenu(null);
                  requestSquashSelection();
                }
              : undefined
          }
          onClose={() => setContextMenu(null)}
          onCompareWithHead={(hash) => {
            setComparisonRange({ from: hash, to: "HEAD" });
            setContextMenu(null);
          }}
          onViewFiles={(hash) => {
            const idx = commits.findIndex((c) => c.hash === hash);
            if (idx >= 0) {
              selectCommit(idx);
            }
            setContextMenu(null);
          }}
          onResetHere={
            scope === "project"
              ? (c) => {
                  setResetTarget(c);
                  setContextMenu(null);
                }
              : undefined
          }
          onResetSoft={
            scope === "project"
              ? (c) => {
                  setResetDirectTarget({ commit: c, mode: "soft" });
                  setContextMenu(null);
                }
              : undefined
          }
          onResetMixed={
            scope === "project"
              ? (c) => {
                  setResetDirectTarget({ commit: c, mode: "mixed" });
                  setContextMenu(null);
                }
              : undefined
          }
          onResetHard={
            scope === "project"
              ? (c) => {
                  setResetDirectTarget({ commit: c, mode: "hard" });
                  setContextMenu(null);
                }
              : undefined
          }
          onRevert={
            scope === "project"
              ? (c) => {
                  setRevertTarget(c);
                  setContextMenu(null);
                }
              : undefined
          }
          onCherryPick={
            scope === "project"
              ? (c) => {
                  setCherryPickTarget(c);
                  setContextMenu(null);
                }
              : undefined
          }
          onCreateBranch={
            scope === "project"
              ? (c) => {
                  setCreateBranchTarget(c);
                  setContextMenu(null);
                }
              : undefined
          }
          onCreateTag={
            scope === "project"
              ? (c) => {
                  setCreateTagTarget(c);
                  setContextMenu(null);
                }
              : undefined
          }
          onInteractiveRebase={
            scope === "project"
              ? (c, action) => {
                  setContextMenu(null);
                  openRebaseEditor(c, action);
                }
              : undefined
          }
          onInteractiveRebaseFromHere={
            scope === "project"
              ? (c) => {
                  setContextMenu(null);
                  setGitInteractiveRebaseView(`${c.hash}^`);
                }
              : undefined
          }
        />
      )}

      {rebaseState && (
        <RebaseEditor
          open
          baseRef={rebaseState.baseRef}
          commits={rebaseState.commits.map((c) => ({
            hash: c.hash,
            subject: c.subject,
            author: c.author,
          }))}
          onCancel={() => setRebaseState(null)}
          onConfirm={async (rawPlan) => {
            const upstream = rebaseState.upstream;
            const targetHash = rebaseState.targetHash;
            const initialAction = rebaseState.initialAction;
            // Apply the menu-chosen single-action to the right-clicked commit
            // when the editor was opened from a context-menu shortcut. If the
            // user re-set the row to pick, respect that. We only override when
            // the row is still on its default `pick`.
            const plan: RebasePlanEntry[] = rawPlan.map((entry) => {
              if (
                entry.hash === targetHash &&
                entry.action === "pick" &&
                initialAction !== "pick"
              ) {
                return { ...entry, action: initialAction };
              }

              return entry;
            });
            setRebaseState(null);
            try {
              await gitRebaseInteractiveRun(sessionId, {
                upstream,
                plan,
              });
            } catch (err) {
              if (err instanceof GitError) {
                setOpBanner({ kind: err.kind, message: err.message });
              } else {
                setOpBanner({
                  kind: "unknown",
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }}
        />
      )}

      {opBanner && (
        <GitErrorBanner
          kind={opBanner.kind}
          message={opBanner.message}
          onAction={(actionId) => {
            if (actionId === "copy-stderr") {
              navigator.clipboard
                ?.writeText(opBanner.message)
                .catch(() => undefined);
            }
            // open-conflicts routes through GitView's `inProgress` watcher;
            // dismiss the banner so the parent's conflict UI takes over.
            setOpBanner(null);
          }}
          onDismiss={() => setOpBanner(null)}
        />
      )}

      {resetTarget && (
        <ResetDialog
          open
          targetRef={resetTarget.abbreviatedHash}
          targetSubject={resetTarget.subject}
          onCancel={() => setResetTarget(null)}
          onConfirm={async (r: ResetDialogResult) => {
            const target = resetTarget;
            setResetTarget(null);
            if (!target) {
              return;
            }
            try {
              await gitReset(sessionId, { ref: target.hash, mode: r.mode });
            } catch (err) {
              if (err instanceof GitError) {
                setOpBanner({ kind: err.kind, message: err.message });
              }
            }
          }}
        />
      )}

      <DestructiveConfirm
        open={Boolean(commitDropConfirm)}
        title={(() => {
          if (!commitDropConfirm) {
            return "";
          }

          return commitDropConfirm.fixup ? `Fixup commit?` : `Squash commits?`;
        })()}
        description={(() => {
          if (!commitDropConfirm) {
            return "";
          }
          const { source, target, fixup } = commitDropConfirm;
          if (fixup) {
            return `Fold "${source.subject}" into "${target.subject}", discarding the source's commit message. This rewrites history.`;
          }

          return `Combine "${source.subject}" into "${target.subject}", merging both messages. This rewrites history.`;
        })()}
        confirmLabel={commitDropConfirm?.fixup ? "Fixup" : "Squash"}
        tone="warning"
        onConfirm={async () => {
          const target = commitDropConfirm;
          setCommitDropConfirm(null);
          if (!target) {
            return;
          }
          await runCommitDropOnto(target.source, target.target, target.fixup);
        }}
        onCancel={() => setCommitDropConfirm(null)}
      />

      <DestructiveConfirm
        open={Boolean(reorderConfirm)}
        title="Reorder commits?"
        description={
          reorderConfirm
            ? `Move "${reorderConfirm.source.subject}" ${reorderConfirm.position} "${reorderConfirm.target.subject}". This rewrites history.`
            : ""
        }
        confirmLabel="Reorder"
        tone="warning"
        onConfirm={async () => {
          const target = reorderConfirm;
          setReorderConfirm(null);
          if (!target) {
            return;
          }
          await runCommitReorder(target.source, target.target, target.position);
        }}
        onCancel={() => setReorderConfirm(null)}
      />

      <DestructiveConfirm
        open={Boolean(squashConfirm)}
        title={
          squashConfirm
            ? `Squash ${squashConfirm.commits.length} commits into one?`
            : ""
        }
        description={
          squashConfirm
            ? `Combine ${squashConfirm.commits.length} commits — from "${squashConfirm.commits[0]!.subject}" back to "${squashConfirm.commits[squashConfirm.commits.length - 1]!.subject}" — into a single commit. This rewrites history.`
            : ""
        }
        confirmLabel="Squash"
        tone="warning"
        onConfirm={async () => {
          const target = squashConfirm;
          setSquashConfirm(null);
          if (!target) {
            return;
          }
          await runSquashSelection(target.commits);
        }}
        onCancel={() => setSquashConfirm(null)}
      />

      <DestructiveConfirm
        open={Boolean(revertTarget)}
        title="Revert commit?"
        description={
          revertTarget
            ? `Create a new commit that undoes ${revertTarget.abbreviatedHash} — ${revertTarget.subject}`
            : ""
        }
        confirmLabel="Revert"
        tone="warning"
        onConfirm={async () => {
          const target = revertTarget;
          setRevertTarget(null);
          if (!target) {
            return;
          }
          try {
            await gitRevert(sessionId, { hash: target.hash });
          } catch (err) {
            if (err instanceof GitError) {
              setOpBanner({ kind: err.kind, message: err.message });
            }
          }
        }}
        onCancel={() => setRevertTarget(null)}
      />

      <DestructiveConfirm
        open={Boolean(cherryPickTarget)}
        title="Cherry-pick onto current branch?"
        description={
          cherryPickTarget
            ? `Apply ${cherryPickTarget.abbreviatedHash} — ${cherryPickTarget.subject} — onto the current branch.`
            : ""
        }
        confirmLabel="Cherry-pick"
        tone="warning"
        onConfirm={async () => {
          const target = cherryPickTarget;
          setCherryPickTarget(null);
          if (!target) {
            return;
          }
          try {
            await gitCherryPick(sessionId, { hash: target.hash });
          } catch (err) {
            if (err instanceof GitError) {
              setOpBanner({ kind: err.kind, message: err.message });
            }
          }
        }}
        onCancel={() => setCherryPickTarget(null)}
      />

      {/* Direct reset — mode pre-selected from context menu; Hard shows danger confirm. */}
      <DestructiveConfirm
        open={Boolean(resetDirectTarget && resetDirectTarget.mode === "hard")}
        title="Hard reset — discard all changes?"
        description={
          resetDirectTarget
            ? `Reset HEAD to ${resetDirectTarget.commit.abbreviatedHash} — ${resetDirectTarget.commit.subject}. Uncommitted changes will be permanently lost.`
            : ""
        }
        confirmLabel="Hard Reset"
        tone="destructive"
        onConfirm={async () => {
          const target = resetDirectTarget;
          setResetDirectTarget(null);
          if (!target) {
            return;
          }
          try {
            await gitReset(sessionId, {
              ref: target.commit.hash,
              mode: "hard",
            });
          } catch (err) {
            if (err instanceof GitError) {
              setOpBanner({ kind: err.kind, message: err.message });
            }
          }
        }}
        onCancel={() => setResetDirectTarget(null)}
      />

      {resetDirectTarget && resetDirectTarget.mode !== "hard" && (
        <ResetDialog
          open
          targetRef={resetDirectTarget.commit.abbreviatedHash}
          targetSubject={resetDirectTarget.commit.subject}
          defaultMode={resetDirectTarget.mode}
          onCancel={() => setResetDirectTarget(null)}
          onConfirm={async (r: ResetDialogResult) => {
            const target = resetDirectTarget;
            setResetDirectTarget(null);
            if (!target) {
              return;
            }
            try {
              await gitReset(sessionId, {
                ref: target.commit.hash,
                mode: r.mode,
              });
            } catch (err) {
              if (err instanceof GitError) {
                setOpBanner({ kind: err.kind, message: err.message });
              }
            }
          }}
        />
      )}

      {createBranchTarget && (
        <BranchDialog
          open
          currentBranch={createBranchTarget.abbreviatedHash}
          defaultStartPoint={createBranchTarget.hash}
          defaultSwitchTo={false}
          onConfirm={async (r: BranchDialogResult) => {
            const target = createBranchTarget;
            setCreateBranchTarget(null);
            try {
              await gitCreateBranch(sessionId, {
                name: r.name,
                startPoint: target.hash,
                checkout: r.switchTo,
              });
            } catch (err) {
              if (err instanceof GitError) {
                setOpBanner({ kind: err.kind, message: err.message });
              }
            }
          }}
          onCancel={() => setCreateBranchTarget(null)}
        />
      )}

      {createTagTarget && (
        <TagDialog
          open
          mode="create"
          defaultRef={createTagTarget.hash}
          onConfirm={async (opts: TagDialogConfirm) => {
            const target = createTagTarget;
            setCreateTagTarget(null);
            try {
              await gitCreateTag(sessionId, {
                name: opts.name,
                ref: target.hash,
                message: opts.message,
                sign: opts.sign,
              });
            } catch (err) {
              if (err instanceof GitError) {
                setOpBanner({ kind: err.kind, message: err.message });
              }
            }
          }}
          onCancel={() => setCreateTagTarget(null)}
        />
      )}
    </>
  );
}

interface TreeNode {
  children: Map<string, TreeNode>;
  fileIndex?: number;
  name: string;
}

function buildTree(diffFiles: DiffFile[]): TreeNode {
  const root: TreeNode = { children: new Map(), name: "" };
  diffFiles.forEach((file, idx) => {
    const path = file.newPath || file.oldPath;
    const parts = path.split("/");
    let cursor = root;
    parts.forEach((part, i) => {
      let next = cursor.children.get(part);
      if (!next) {
        next = { children: new Map(), name: part };
        cursor.children.set(part, next);
      }
      if (i === parts.length - 1) {
        next.fileIndex = idx;
      }
      cursor = next;
    });
  });

  return root;
}

interface FileTreeListProps {
  diffFiles: DiffFile[];
  expandedFiles: Set<number>;
  fileStats: { adds: number; dels: number }[];
  onToggle: (i: number) => void;
  sessionId: string;
}

function FileTreeList({
  diffFiles,
  expandedFiles,
  fileStats,
  onToggle,
  sessionId,
}: FileTreeListProps) {
  const tree = useMemo(() => buildTree(diffFiles), [diffFiles]);

  const renderNode = (
    node: TreeNode,
    depth: number,
    key: string,
  ): ReactNode => {
    if (node.fileIndex !== undefined) {
      const i = node.fileIndex;
      const file = diffFiles[i]!;
      const isExpanded = expandedFiles.has(i);
      const stat = fileStats[i] ?? { adds: 0, dels: 0 };

      return (
        <div key={key}>
          <button
            className={`${styles.fileRow} ${isExpanded ? styles.fileRowExpanded : ""}`}
            style={{ paddingLeft: 14 + depth * 14 }}
            onClick={() => onToggle(i)}
          >
            <span className={styles.fileChevron}>
              {isExpanded ? (
                <Icons.ChevronDownIcon size={10} />
              ) : (
                <Icons.ChevronRightIcon size={8} />
              )}
            </span>
            <span
              className={`${styles.fileBadge} ${styles[`badge${file.status}`]}`}
              title={statusLabel(file.status)}
            >
              {file.status}
            </span>
            <span className={styles.filePath}>{node.name}</span>
            <span className={styles.fileStats}>
              {stat.adds > 0 && (
                <span className={styles.fileStatAdd}>+{stat.adds}</span>
              )}
              {stat.dels > 0 && (
                <span className={styles.fileStatDel}>−{stat.dels}</span>
              )}
            </span>
          </button>
          {isExpanded && (
            <div className={styles.fileDiffInline}>
              <FileDiffView
                file={file}
                inline
                readOnly
                sessionId={sessionId}
                onAction={async () => undefined}
              />
            </div>
          )}
        </div>
      );
    }

    const children = Array.from(node.children.values());

    return (
      <div key={key}>
        <div
          className={styles.treeFolder}
          style={{ paddingLeft: 14 + depth * 14 }}
        >
          <Icons.ChevronDownIcon size={10} />
          <span className={styles.treeFolderName}>{node.name}</span>
        </div>
        {children.map((child, i) =>
          renderNode(child, depth + 1, `${key}/${child.name}-${i}`),
        )}
      </div>
    );
  };

  const topChildren = Array.from(tree.children.values());

  return (
    <>{topChildren.map((c, i) => renderNode(c, 0, `top-${c.name}-${i}`))}</>
  );
}
