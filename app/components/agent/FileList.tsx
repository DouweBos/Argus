import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { stageFile, unstageFile } from "../../lib/ipc";
import type { DiffFile } from "../../lib/diffParser";
import { StagedIcon } from "../shared/Icons";
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

  const sortedFiles = useMemo(() => {
    const statusOrder: Record<string, number> = { A: 0, M: 1, R: 2, D: 3 };
    let filtered = files;
    if (searchFilter && searchFilter.trim()) {
      const q = searchFilter.trim().toLowerCase();
      filtered = files.filter((f) => {
        const path = (f.newPath || f.oldPath).toLowerCase();
        return path.includes(q);
      });
    }
    return [...filtered].sort((a, b) => {
      let cmp: number;
      if (sortField === "status") {
        cmp = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      } else {
        const pathA = (a.newPath || a.oldPath).toLowerCase();
        const pathB = (b.newPath || b.oldPath).toLowerCase();
        cmp = pathA.localeCompare(pathB);
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [files, sortField, sortAsc, searchFilter]);

  const handleClick = useCallback(
    (i: number, e: React.MouseEvent) => {
      const metaKey = e.metaKey || e.ctrlKey;

      if (metaKey && e.shiftKey) {
        // Cmd+Shift+Click: range select from last clicked to current
        const from = Math.min(lastClickedRef.current, i);
        const to = Math.max(lastClickedRef.current, i);
        const next = new Set(selectedIndices);
        for (let idx = from; idx <= to; idx++) {
          next.add(idx);
        }
        onSelectionChange(next);
      } else if (metaKey) {
        // Cmd+Click: toggle individual
        const next = new Set(selectedIndices);
        if (next.has(i)) {
          next.delete(i);
        } else {
          next.add(i);
        }
        onSelectionChange(next);
        lastClickedRef.current = i;
      } else {
        // Plain click: select only this
        onSelectionChange(new Set([i]));
        lastClickedRef.current = i;
      }

      fileItemRefs.current[i]?.focus();
    },
    [selectedIndices, onSelectionChange],
  );

  // Cmd+A handler on the container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        const all = new Set<number>();
        for (let i = 0; i < sortedFiles.length; i++) {
          all.add(i);
        }
        onSelectionChange(all);
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [sortedFiles.length, onSelectionChange]);

  return (
    <div className={styles.fileListScroll} ref={containerRef} tabIndex={-1}>
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
      {sortedFiles.map((file, i) => {
        const path = file.newPath || file.oldPath;
        const isSelected = selectedIndices.has(i);
        return (
          <button
            key={`${path}-${i}`}
            ref={(el) => {
              fileItemRefs.current[i] = el;
            }}
            className={`${styles.fileListItem} ${isSelected ? styles.fileListItemActive : ""}`}
            onClick={(e) => handleClick(i, e)}
            onKeyDown={(e) => {
              if (e.key === " ") {
                e.preventDefault();
                const fp = file.newPath || file.oldPath;
                if (file.staged === "full") {
                  onAction(() => unstageFile(workspaceId, fp));
                } else {
                  onAction(() => stageFile(workspaceId, fp));
                }
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                if (i < sortedFiles.length - 1) {
                  onSelectionChange(new Set([i + 1]));
                  lastClickedRef.current = i + 1;
                  fileItemRefs.current[i + 1]?.focus();
                }
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (i > 0) {
                  onSelectionChange(new Set([i - 1]));
                  lastClickedRef.current = i - 1;
                  fileItemRefs.current[i - 1]?.focus();
                }
              }
            }}
          >
            <span className={styles.fileItemStatus}>
              <StagedIcon
                staged={file.staged}
                className={
                  file.staged === "full"
                    ? styles.stagedIconFull
                    : file.staged === "partial"
                      ? styles.stagedIconPartial
                      : styles.stagedIconNone
                }
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
