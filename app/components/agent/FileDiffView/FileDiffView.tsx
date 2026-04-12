import type { DiffFile, DiffHunk } from "../../../lib/diffParser";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { buildPartialPatch } from "../../../lib/diffParser";
import {
  discardFile,
  discardHunk,
  stageHunk,
  unstageHunk,
} from "../../../lib/ipc";
import { FileIcon, TrashIcon } from "../../shared/Icons";
import { HunkSection } from "../HunkSection";
import styles from "./FileDiffView.module.css";

export interface FileDiffViewProps {
  file: DiffFile;
  /** When true, renders inline (no flex:1, no overflow hidden) for stacking multiple views. */
  inline?: boolean;
  onAction: (action: () => Promise<void>) => Promise<void>;
  workspaceId: string;
}

// Map from hunkIndex -> Set of line indices within that hunk
type LineSelection = Map<number, Set<number>>;

/**
 * Wrapper that remounts the inner component when the file changes,
 * so all local state (view mode, selection) resets automatically.
 */
export function FileDiffView(props: FileDiffViewProps): ReactElement {
  const fileKey = props.file.newPath || props.file.oldPath;

  return <FileDiffViewInner key={fileKey} {...props} />;
}

function FileDiffViewInner({
  file,
  workspaceId,
  onAction,
  inline,
}: FileDiffViewProps) {
  const displayPath = file.newPath || file.oldPath;
  const fileName = displayPath.split("/").pop() ?? displayPath;

  // Whether each view has content
  const hasStaged = file.staged === "full" || file.staged === "partial";
  const hasUnstaged = file.staged === "none" || file.staged === "partial";

  // View mode: show only staged or only unstaged changes.
  // Raw state tracks user intent; we derive effective mode below.
  const [viewModeRaw, setViewModeRaw] = useState<"staged" | "unstaged">(() =>
    file.staged === "full" ? "staged" : "unstaged",
  );

  // Derive effective mode: auto-switch if current view is empty
  const viewMode = useMemo(() => {
    if (viewModeRaw === "staged" && !hasStaged && hasUnstaged) {
      return "unstaged";
    }
    if (viewModeRaw === "unstaged" && !hasUnstaged && hasStaged) {
      return "staged";
    }

    return viewModeRaw;
  }, [viewModeRaw, hasStaged, hasUnstaged]);

  // Filter hunks based on view mode
  const visibleHunks = useMemo(() => {
    // Fully staged file: "staged" shows everything, "unstaged" shows nothing
    if (file.staged === "full") {
      return viewMode === "staged" ? file.hunks : [];
    }

    // Nothing staged: "unstaged" shows everything, "staged" shows nothing
    if (file.staged === "none") {
      return viewMode === "unstaged" ? file.hunks : [];
    }

    // Partially staged: filter lines
    return file.hunks
      .map((hunk) => {
        const filteredLines = hunk.lines.filter((line) => {
          if (line.type === "context") {
            return true;
          }
          if (viewMode === "staged") {
            return line.staged === true;
          }

          return line.staged !== true;
        });
        const hasChanges = filteredLines.some((l) => l.type !== "context");
        if (!hasChanges) {
          return null;
        }

        return { ...hunk, lines: filteredLines };
      })
      .filter((h): h is DiffHunk => h !== null);
  }, [file, viewMode]);

  const stats = useMemo(() => {
    let adds = 0;
    let removes = 0;
    let chunks = 0;
    for (const h of visibleHunks) {
      chunks++;
      for (const l of h.lines) {
        if (l.type === "add") {
          adds++;
        } else if (l.type === "remove") {
          removes++;
        }
      }
    }

    return { adds, removes, chunks };
  }, [visibleHunks]);

  // Line selection state
  const [selection, setSelection] = useState<LineSelection>(new Map());
  const lastClickRef = useRef<{ hunk: number; line: number } | null>(null);

  // Drag state for gutter selection
  const dragRef = useRef<{
    anchorLine: number;
    /** Selection snapshot before this drag started */
    baseSel: LineSelection;
    hunkIndex: number;
    /** "add" = dragging adds to selection, "remove" = dragging removes */
    mode: "add" | "remove";
  } | null>(null);

  /** Apply a range operation (add or remove) on top of a base selection. */
  const applyRange = useCallback(
    (
      hunkIndex: number,
      from: number,
      to: number,
      base: LineSelection,
      mode: "add" | "remove",
    ) => {
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      const hunkSet = new Set(base.get(hunkIndex) ?? []);
      for (let i = start; i <= end; i++) {
        const l = file.hunks[hunkIndex]?.lines[i];
        if (l && l.type !== "context") {
          if (mode === "add") {
            hunkSet.add(i);
          } else {
            hunkSet.delete(i);
          }
        }
      }

      const next = new Map(base);
      if (hunkSet.size === 0) {
        next.delete(hunkIndex);
      } else {
        next.set(hunkIndex, hunkSet);
      }

      return next;
    },
    [file.hunks],
  );

  const handleGutterMouseDown = useCallback(
    (hunkIndex: number, lineIndex: number, shiftKey: boolean) => {
      const line = file.hunks[hunkIndex]?.lines[lineIndex];
      if (!line || line.type === "context") {
        return;
      }

      if (shiftKey && lastClickRef.current) {
        const lastHunk = lastClickRef.current.hunk;
        const lastLine = lastClickRef.current.line;
        if (lastHunk === hunkIndex) {
          setSelection((prev) =>
            applyRange(hunkIndex, lastLine, lineIndex, prev, "add"),
          );
        }

        return;
      }

      // Determine drag mode from whether anchor is currently selected
      setSelection((prev) => {
        const wasSelected = prev.get(hunkIndex)?.has(lineIndex) ?? false;
        const mode = wasSelected ? "remove" : "add";
        const base = new Map(prev);
        dragRef.current = {
          hunkIndex,
          anchorLine: lineIndex,
          mode,
          baseSel: base,
        };

        return applyRange(hunkIndex, lineIndex, lineIndex, base, mode);
      });

      lastClickRef.current = { hunk: hunkIndex, line: lineIndex };
    },
    [file.hunks, applyRange],
  );

  const handleGutterMouseEnter = useCallback(
    (hunkIndex: number, lineIndex: number) => {
      const drag = dragRef.current;
      if (!drag || drag.hunkIndex !== hunkIndex) {
        return;
      }
      setSelection(
        applyRange(
          hunkIndex,
          drag.anchorLine,
          lineIndex,
          drag.baseSel,
          drag.mode,
        ),
      );
    },
    [applyRange],
  );

  // End drag on mouseup
  useEffect(() => {
    const onMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("mouseup", onMouseUp);

    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(new Map());
    lastClickRef.current = null;
  }, []);

  const handleLineAction = useCallback(
    (
      mode: "discard" | "stage" | "unstage",
      hunkIndex: number,
      indices: Set<number>,
    ) => {
      const hunk = file.hunks[hunkIndex];
      if (!hunk) {
        return;
      }
      const patch = buildPartialPatch(file, hunk, indices);
      const action = async () => {
        if (mode === "stage") {
          await stageHunk(workspaceId, patch);
        } else if (mode === "unstage") {
          await unstageHunk(workspaceId, patch);
        } else {
          await discardHunk(workspaceId, patch);
        }

        clearSelection();
      };

      onAction(action);
    },
    [file, workspaceId, onAction, clearSelection],
  );

  return (
    <div
      className={`${styles.fileDiffContainer} ${inline ? styles.fileDiffInline : ""}`}
    >
      {/* File header bar */}
      <div className={styles.fileDiffHeader}>
        <FileIcon className={styles.fileIcon} />
        <span className={styles.fileDiffName}>{fileName}</span>
        <div className={styles.fileDiffActions}>
          <button
            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
            title="Discard all changes to this file"
            onClick={() =>
              onAction(() => discardFile(workspaceId, displayPath))
            }
          >
            <TrashIcon />
          </button>
          <div className={styles.stagedToggle}>
            <button
              className={`${styles.stagedBtn} ${viewMode === "staged" ? styles.stagedBtnActive : ""}`}
              disabled={!hasStaged}
              onClick={() => setViewModeRaw("staged")}
            >
              Staged
            </button>
            <button
              className={`${styles.unstagedBtn} ${viewMode === "unstaged" ? styles.unstagedBtnActive : ""}`}
              disabled={!hasUnstaged}
              onClick={() => setViewModeRaw("unstaged")}
            >
              Unstaged
            </button>
          </div>
        </div>
      </div>

      {/* Stats subheader */}
      <div className={styles.fileDiffStats}>
        {stats.chunks} {stats.chunks === 1 ? "chunk" : "chunks"}, {stats.adds}{" "}
        {stats.adds === 1 ? "insertion" : "insertions"}, {stats.removes}{" "}
        {stats.removes === 1 ? "deletion" : "deletions"}
      </div>

      {/* Diff content */}
      <div className={styles.fileDiffContent}>
        {visibleHunks.map((hunk, hi) => (
          <HunkSection
            key={hi}
            hunk={hunk}
            hunkIndex={hi}
            selectedLines={selection.get(hi)}
            workspaceId={workspaceId}
            onAction={onAction}
            onGutterMouseDown={handleGutterMouseDown}
            onGutterMouseEnter={handleGutterMouseEnter}
            onLineAction={handleLineAction}
          />
        ))}
      </div>

      {/* Bottom status bar */}
      <div className={styles.fileDiffFooter}>
        <span className={styles.footerStats}>
          {stats.chunks} {stats.chunks === 1 ? "chunk" : "chunks"},{" "}
          <span className={styles.statAdd}>
            {stats.adds} {stats.adds === 1 ? "insertion" : "insertions"}
          </span>
          ,{" "}
          <span className={styles.statRemove}>
            {stats.removes} {stats.removes === 1 ? "deletion" : "deletions"}
          </span>
        </span>
      </div>
    </div>
  );
}
