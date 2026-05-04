import type { GitCommit } from "../../../lib/ipc";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useDndState, useDraggable, useDropTarget } from "@argus/peacock";
import styles from "../HistoryView/HistoryView.module.css";
import {
  buildCommitDragImage,
  commitDropModeForY,
  type CommitDropMode,
} from "./utils";

export interface CommitRowProps {
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
 * Single commit row in the history list. The row's button is both:
 *   - drag source — carrying the commit hash (sidebar branch rows pick it up
 *     to cherry-pick / reset)
 *   - drop target — for tag drags (move/create the tag here) and for commit
 *     drags. Commit drags discriminate by cursor Y inside the row:
 *       top 8px       → reorder above this row
 *       bottom 8px*   → reorder below (last row only)
 *       middle        → squash (default) / fixup (⌥)
 */
export function CommitRow({
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
