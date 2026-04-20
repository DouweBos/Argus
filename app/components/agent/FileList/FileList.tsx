import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import { type DiffFile, gitIndexPath } from "../../../lib/diffParser";
import { stageFile, unstageFile } from "../../../lib/ipc";
import styles from "./FileList.module.css";

export interface FileListProps {
  files: DiffFile[];
  onAction: (action: () => Promise<void>) => Promise<void>;
  onSelectionChange: (indices: Set<number>) => void;
  searchFilter?: string;
  selectedIndices: Set<number>;
  workspaceId: string;
}

type SortField = "filename" | "status";

function stagedIconClassForFile(staged: DiffFile["staged"]): string {
  if (staged === "full") {
    return styles.stagedIconFull;
  }
  if (staged === "partial") {
    return styles.stagedIconPartial;
  }

  return styles.stagedIconNone;
}

export function FileList({
  files,
  workspaceId,
  selectedIndices,
  onSelectionChange,
  onAction,
  searchFilter,
}: FileListProps) {
  const [sortField, setSortField] = useState<SortField>("filename");
  const [sortAsc, setSortAsc] = useState(true);
  const fileItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lastClickedRef = useRef<number>(0);
  /** List index (sorted/filtered order) of the anchor row for Shift+arrow ranges — plain click / plain arrows / Cmd+click. */
  const pivotListIndexRef = useRef(0);
  /** Moving end of the Shift+arrow range; equals pivot when selection is a single row. */
  const headListIndexRef = useRef(0);
  /**
   * Files chosen via plain click or Cmd+click (not the contiguous block added only by Shift+arrows).
   * Shift+arrow selection = base ∪ sorted list range(pivot, head) when pivot !== head.
   */
  const baseSelectionRef = useRef<Set<number>>(new Set());
  const prevWorkspaceIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortAsc((a) => !a);
      } else {
        setSortField(field);
        setSortAsc(true);
      }
    },
    [sortField],
  );

  /** Sorted / filtered rows; `originalIndex` indexes into the parent `files` array. */
  const sortedEntries = useMemo(() => {
    const statusOrder: Record<string, number> = { A: 0, M: 1, R: 2, D: 3 };
    const indexed = files.map((file, originalIndex) => ({
      file,
      originalIndex,
    }));
    let filtered = indexed;
    if (searchFilter && searchFilter.trim()) {
      const q = searchFilter.trim().toLowerCase();
      filtered = indexed.filter(({ file: f }) => {
        const path = (f.newPath || f.oldPath).toLowerCase();

        return path.includes(q);
      });
    }

    return [...filtered].sort((a, b) => {
      let cmp: number;
      if (sortField === "status") {
        cmp =
          (statusOrder[a.file.status] ?? 9) - (statusOrder[b.file.status] ?? 9);
      } else {
        const pathA = (a.file.newPath || a.file.oldPath).toLowerCase();
        const pathB = (b.file.newPath || b.file.oldPath).toLowerCase();
        cmp = pathA.localeCompare(pathB);
      }

      return sortAsc ? cmp : -cmp;
    });
  }, [files, sortField, sortAsc, searchFilter]);

  const indicesForPivotHead = useCallback(
    (pivot: number, head: number) => {
      const lo = Math.min(pivot, head);
      const hi = Math.max(pivot, head);
      const next = new Set<number>();
      for (let li = lo; li <= hi; li++) {
        const entry = sortedEntries[li];
        if (entry) {
          next.add(entry.originalIndex);
        }
      }

      return next;
    },
    [sortedEntries],
  );

  const mergeKeyboardSelection = useCallback(
    (base: Set<number>, pivot: number, head: number) => {
      if (pivot === head) {
        return new Set(base);
      }

      const rangeSet = indicesForPivotHead(pivot, head);

      return new Set([...base, ...rangeSet]);
    },
    [indicesForPivotHead],
  );

  /** List indices of currently selected rows that appear in the sorted/filtered list. */
  const listIndicesOfSelection = useCallback(
    (selection: Set<number>) => {
      const listIndexByOriginal = new Map(
        sortedEntries.map((entry, li) => [entry.originalIndex, li]),
      );
      const out: number[] = [];
      for (const orig of selection) {
        const li = listIndexByOriginal.get(orig);
        if (li !== undefined) {
          out.push(li);
        }
      }

      return out;
    },
    [sortedEntries],
  );

  /**
   * Other end of a Shift+click range: the visible selected row closest to `clickedListIndex`
   * in sorted order; ties go to the smaller list index. If nothing is selected in view, uses `fallbackListIndex`.
   */
  const closestSelectedListIndex = useCallback(
    (
      clickedListIndex: number,
      selection: Set<number>,
      fallbackListIndex: number,
    ) => {
      const selectedListIndices = listIndicesOfSelection(selection);
      if (selectedListIndices.length === 0) {
        return fallbackListIndex;
      }

      let closest = selectedListIndices[0]!;
      let bestDist = Math.abs(clickedListIndex - closest);
      for (const li of selectedListIndices) {
        const d = Math.abs(clickedListIndex - li);
        if (d < bestDist || (d === bestDist && li < closest)) {
          bestDist = d;
          closest = li;
        }
      }

      return closest;
    },
    [listIndicesOfSelection],
  );

  const handleClick = useCallback(
    (listIndex: number, originalIndex: number, e: React.MouseEvent) => {
      const metaKey = e.metaKey || e.ctrlKey;

      if (e.shiftKey) {
        // Shift+click (with or without Cmd): range from click to closest already-selected row (visible)
        const anchor = closestSelectedListIndex(
          listIndex,
          selectedIndices,
          lastClickedRef.current,
        );
        const from = Math.min(anchor, listIndex);
        const to = Math.max(anchor, listIndex);
        const next = new Set(selectedIndices);
        for (let idx = from; idx <= to; idx++) {
          const entry = sortedEntries[idx];
          if (entry) {
            next.add(entry.originalIndex);
          }
        }

        onSelectionChange(next);
        baseSelectionRef.current = new Set(next);
        lastClickedRef.current = listIndex;
        pivotListIndexRef.current = listIndex;
        headListIndexRef.current = listIndex;
      } else if (metaKey) {
        // Cmd+Click: toggle individual (base layer only — Shift+arrow range is merged on top)
        const next = new Set(baseSelectionRef.current);
        if (next.has(originalIndex)) {
          next.delete(originalIndex);
        } else {
          next.add(originalIndex);
        }

        baseSelectionRef.current = next;
        pivotListIndexRef.current = listIndex;
        headListIndexRef.current = listIndex;
        lastClickedRef.current = listIndex;
        onSelectionChange(mergeKeyboardSelection(next, listIndex, listIndex));
      } else {
        // Plain click: select only this
        const single = new Set([originalIndex]);
        baseSelectionRef.current = single;
        pivotListIndexRef.current = listIndex;
        headListIndexRef.current = listIndex;
        lastClickedRef.current = listIndex;
        onSelectionChange(single);
      }

      fileItemRefs.current[listIndex]?.focus();
    },
    [
      closestSelectedListIndex,
      mergeKeyboardSelection,
      onSelectionChange,
      selectedIndices,
      sortedEntries,
    ],
  );

  // Cmd+A / Ctrl+A: select all visible (filtered/sorted) files. Use capture so
  // the focused file row button still receives the shortcut (bubble alone does
  // not reliably reach this ancestor before browser default handling).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const isSelectAll =
        (e.metaKey || e.ctrlKey) &&
        (e.key === "a" || e.key === "A" || e.code === "KeyA");
      if (!isSelectAll) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      const all = new Set<number>();
      for (const { originalIndex } of sortedEntries) {
        all.add(originalIndex);
      }

      baseSelectionRef.current = all;
      onSelectionChange(all);
      const last = sortedEntries.length - 1;
      if (last >= 0) {
        pivotListIndexRef.current = 0;
        headListIndexRef.current = last;
        fileItemRefs.current[last]?.focus();
      }
    };

    container.addEventListener("keydown", handleKeyDown, true);

    return () => container.removeEventListener("keydown", handleKeyDown, true);
  }, [sortedEntries, onSelectionChange]);

  useEffect(() => {
    if (prevWorkspaceIdRef.current !== workspaceId) {
      prevWorkspaceIdRef.current = workspaceId;
      baseSelectionRef.current = new Set(selectedIndices);
    }
  }, [selectedIndices, workspaceId]);

  useEffect(() => {
    const max = sortedEntries.length - 1;
    if (max < 0) {
      return;
    }

    pivotListIndexRef.current = Math.min(pivotListIndexRef.current, max);
    headListIndexRef.current = Math.min(headListIndexRef.current, max);
  }, [sortedEntries.length]);

  return (
    <div ref={containerRef} className={styles.fileListScroll} tabIndex={-1}>
      <div className={styles.fileListColumns}>
        <button
          className={styles.colStatus}
          onClick={() => toggleSort("status")}
        >
          Status
          {sortField === "status" && (
            <span className={styles.sortIcon}>{sortAsc ? "▲" : "▼"}</span>
          )}
        </button>
        <button
          className={styles.colFilename}
          onClick={() => toggleSort("filename")}
        >
          <span>Filename</span>
          {sortField === "filename" && (
            <span className={styles.sortIcon}>{sortAsc ? "▲" : "▼"}</span>
          )}
        </button>
      </div>
      {sortedEntries.map(({ file, originalIndex }, i) => {
        const path = file.newPath || file.oldPath;
        const isSelected = selectedIndices.has(originalIndex);

        return (
          <button
            key={`${originalIndex}-${path}`}
            ref={(el) => {
              fileItemRefs.current[i] = el;
            }}
            className={`${styles.fileListItem} ${isSelected ? styles.fileListItemActive : ""}`}
            onClick={(e) => handleClick(i, originalIndex, e)}
            onKeyDown={(e) => {
              if (e.key === " " || e.code === "Space") {
                e.preventDefault();
                const indices =
                  selectedIndices.size > 0
                    ? [...selectedIndices].sort((a, b) => a - b)
                    : [originalIndex];
                onAction(async () => {
                  const selectedFiles = indices
                    .map((idx) => files[idx])
                    .filter((f): f is NonNullable<typeof f> => f != null);
                  if (selectedFiles.length === 0) {
                    return;
                  }

                  const allFullyStaged = selectedFiles.every(
                    (f) => f.staged === "full",
                  );

                  if (allFullyStaged) {
                    for (const f of selectedFiles) {
                      await unstageFile(workspaceId, gitIndexPath(f));
                    }
                  } else {
                    for (const f of selectedFiles) {
                      if (f.staged !== "full") {
                        await stageFile(workspaceId, gitIndexPath(f));
                      }
                    }
                  }
                });
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const len = sortedEntries.length;
                if (len === 0) {
                  return;
                }

                const lastIdx = len - 1;
                const delta = e.key === "ArrowDown" ? 1 : -1;

                if (e.shiftKey) {
                  let newHead = headListIndexRef.current;
                  const pivot = pivotListIndexRef.current;

                  if (delta > 0) {
                    if (newHead < pivot) {
                      newHead = Math.min(newHead + 1, pivot);
                    } else {
                      newHead = Math.min(newHead + 1, lastIdx);
                    }
                  } else if (newHead > pivot) {
                    newHead = Math.max(newHead - 1, pivot);
                  } else {
                    newHead = Math.max(newHead - 1, 0);
                  }

                  headListIndexRef.current = newHead;
                  onSelectionChange(
                    mergeKeyboardSelection(
                      baseSelectionRef.current,
                      pivot,
                      newHead,
                    ),
                  );
                  fileItemRefs.current[newHead]?.focus();
                } else {
                  const newRow = Math.max(0, Math.min(i + delta, lastIdx));
                  pivotListIndexRef.current = newRow;
                  headListIndexRef.current = newRow;
                  lastClickedRef.current = newRow;
                  const entry = sortedEntries[newRow];
                  if (entry) {
                    const single = new Set([entry.originalIndex]);
                    baseSelectionRef.current = single;
                    onSelectionChange(single);
                  }

                  fileItemRefs.current[newRow]?.focus();
                }
              }
            }}
          >
            <span className={styles.fileItemStatus}>
              <Icons.StagedIcon
                className={stagedIconClassForFile(file.staged)}
                staged={file.staged}
              />
              <span
                className={`${styles.fileItemBadge} ${styles[`badge${file.status}`]}`}
              >
                {file.status}
              </span>
            </span>
            <span className={styles.fileItemPath}>
              <span className={styles.fileItemPathInner}>{path}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
