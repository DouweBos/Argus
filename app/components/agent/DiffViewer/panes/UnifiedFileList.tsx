import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { EmptyState, Icons, useDraggable } from "@argus/peacock";
import { type DiffFile, gitIndexPath } from "../../../../lib/diffParser";
import styles from "./UnifiedFileList.module.css";

export type SortField = "filename" | "status";

export interface UnifiedFileListProps {
  files: DiffFile[];
  highlighted: string | null;
  onContextMenu: (path: string, x: number, y: number) => void;
  onDiscard: (path: string) => void;
  onHighlight: (path: string) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  searchQuery: string;
  sessionId: string;
}

function badgeKindFor(
  status: string,
): "added" | "deleted" | "modified" | "renamed" {
  switch (status) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}

function pathOf(f: DiffFile): string {
  return gitIndexPath(f);
}

const STATUS_ORDER: Record<string, number> = { A: 0, M: 1, R: 2, D: 3 };

function stagedCheckboxClass(
  staged: DiffFile["staged"],
  s: Record<string, string>,
): string {
  if (staged === "full") {
    return s.checkboxFull ?? "";
  }
  if (staged === "partial") {
    return s.checkboxPartial ?? "";
  }

  return s.checkboxEmpty ?? "";
}

/**
 * Single-column file list for the working copy view.
 *
 * Each row shows:
 *   [StagedIcon checkbox] [status badge] [dir prefix (muted)] [basename]
 *
 * Clicking the StagedIcon toggles staged state. Clicking elsewhere selects
 * the row; the focused row drives the diff detail pane.
 *
 * Multi-selection (Finder-style):
 *   Click            → select only that file
 *   Cmd/Meta+Click   → toggle that file's selection
 *   Shift+Click      → extend selection from the closest already-selected
 *                      file (or the focus) to the clicked file
 *   Shift+ArrowUp/Dn → extend selection one row in that direction
 *
 * Keyboard (when the list holds focus):
 *   Up / Down         → move focus (replaces selection)
 *   Shift+Up / Down   → extend selection one row
 *   Space             → toggle staged/unstaged for the focused row
 *   Delete / Backspace→ discard focused row
 */
export function UnifiedFileList({
  files,
  highlighted,
  searchQuery,
  onHighlight,
  onContextMenu,
  onStage,
  onUnstage,
  onDiscard,
}: UnifiedFileListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [sortField, setSortField] = useState<SortField>("filename");
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(() =>
    highlighted ? new Set([highlighted]) : new Set(),
  );

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

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? files.filter((f) => pathOf(f).toLowerCase().includes(q))
      : files;

    return [...list].sort((a, b) => {
      let cmp: number;
      if (sortField === "status") {
        cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
        if (cmp === 0) {
          cmp = pathOf(a).localeCompare(pathOf(b));
        }
      } else {
        cmp = pathOf(a).localeCompare(pathOf(b));
      }

      return sortAsc ? cmp : -cmp;
    });
  }, [files, searchQuery, sortField, sortAsc]);

  // Effective selection is derived: intersect the stateful selection with
  // currently-visible paths and fall back to the focused file when the
  // result is empty (initial mount, full prune, or files reload). This keeps
  // the focus row always reading as selected without needing an effect.
  const effectiveSelected = useMemo(() => {
    const visible = new Set(filtered.map(pathOf));
    const next = new Set<string>();
    for (const p of selected) {
      if (visible.has(p)) {
        next.add(p);
      }
    }
    if (next.size === 0 && highlighted && visible.has(highlighted)) {
      next.add(highlighted);
    }

    return next;
  }, [filtered, selected, highlighted]);

  const handleContextMenu = useCallback(
    (path: string, e: MouseEvent) => {
      e.preventDefault();
      onContextMenu(path, e.clientX, e.clientY);
    },
    [onContextMenu],
  );

  const handleStageToggle = useCallback(
    (f: DiffFile, e: KeyboardEvent | MouseEvent) => {
      e.stopPropagation();
      if (f.staged === "none") {
        onStage(pathOf(f));
      } else {
        onUnstage(pathOf(f));
      }
    },
    [onStage, onUnstage],
  );

  const handleRowClick = useCallback(
    (path: string, e: MouseEvent) => {
      const paths = filtered.map(pathOf);
      const clickedIdx = paths.indexOf(path);
      if (clickedIdx === -1) {
        return;
      }

      if (e.shiftKey) {
        // Find pivot: the already-selected file closest by index to the
        // clicked file. Falls back to the current focus, then to the click
        // itself if neither is available.
        let pivotIdx = -1;
        let bestDist = Infinity;
        for (const sel of effectiveSelected) {
          const idx = paths.indexOf(sel);
          if (idx === -1) {
            continue;
          }
          const d = Math.abs(idx - clickedIdx);
          if (d < bestDist) {
            bestDist = d;
            pivotIdx = idx;
          }
        }
        if (pivotIdx === -1 && highlighted) {
          pivotIdx = paths.indexOf(highlighted);
        }
        if (pivotIdx === -1) {
          pivotIdx = clickedIdx;
        }
        const lo = Math.min(pivotIdx, clickedIdx);
        const hi = Math.max(pivotIdx, clickedIdx);
        const next = new Set(effectiveSelected);
        for (let i = lo; i <= hi; i++) {
          const p = paths[i];
          if (p) {
            next.add(p);
          }
        }
        setSelected(next);
        onHighlight(path);

        return;
      }

      if (e.metaKey || e.ctrlKey) {
        const next = new Set(effectiveSelected);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        setSelected(next);
        onHighlight(path);

        return;
      }

      // Plain click — single select.
      setSelected(new Set([path]));
      onHighlight(path);
    },
    [filtered, effectiveSelected, highlighted, onHighlight],
  );

  const handleListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!highlighted) {
        return;
      }

      const paths = filtered.map(pathOf);
      const currentIdx = paths.indexOf(highlighted);

      // Up / Down — move focus, optionally extending selection.
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(paths.length - 1, currentIdx + 1)
            : Math.max(0, currentIdx - 1);
        const next = paths[nextIdx];
        if (!next || nextIdx === currentIdx) {
          return;
        }
        if (e.shiftKey) {
          const set = new Set(effectiveSelected);
          set.add(highlighted);
          set.add(next);
          setSelected(set);
        } else {
          setSelected(new Set([next]));
        }
        onHighlight(next);
        const rowEl = listRef.current?.querySelector<HTMLElement>(
          `[data-path="${CSS.escape(next)}"]`,
        );
        rowEl?.scrollIntoView({ block: "nearest" });

        return;
      }

      // Space — toggle staged
      if (e.key === " ") {
        e.preventDefault();
        const f = filtered.find((file) => pathOf(file) === highlighted);
        if (f) {
          if (f.staged === "none") {
            onStage(pathOf(f));
          } else {
            onUnstage(pathOf(f));
          }
        }

        return;
      }

      // Delete / Backspace — discard
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onDiscard(highlighted);
      }
    },
    [
      highlighted,
      filtered,
      effectiveSelected,
      onHighlight,
      onStage,
      onUnstage,
      onDiscard,
    ],
  );

  const sortHeader = (
    <div className={styles.header}>
      <button
        type="button"
        className={`${styles.sortBtn} ${sortField === "status" ? styles.sortBtnActive : ""}`}
        onClick={() => toggleSort("status")}
      >
        Status
        {sortField === "status" && (
          <span className={styles.sortIcon}>
            {sortAsc ? (
              <Icons.ChevronUpIcon size={11} />
            ) : (
              <Icons.ChevronDownIcon size={11} />
            )}
          </span>
        )}
      </button>
      <button
        type="button"
        className={`${styles.sortBtn} ${styles.sortBtnFilename} ${sortField === "filename" ? styles.sortBtnActive : ""}`}
        onClick={() => toggleSort("filename")}
      >
        Filename
        {sortField === "filename" && (
          <span className={styles.sortIcon}>
            {sortAsc ? (
              <Icons.ChevronUpIcon size={11} />
            ) : (
              <Icons.ChevronDownIcon size={11} />
            )}
          </span>
        )}
      </button>
    </div>
  );

  if (filtered.length === 0) {
    return (
      <div className={styles.container}>
        {sortHeader}
        <EmptyState
          className={styles.empty}
          icon={<Icons.FileIcon size={20} />}
          title={files.length === 0 ? "No changes" : "No matches"}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {sortHeader}
      <div
        ref={listRef}
        className={styles.scroll}
        role="listbox"
        aria-label="Changed files"
        aria-multiselectable
        tabIndex={0}
        onKeyDown={handleListKeyDown}
      >
        {filtered.map((f) => {
          const path = pathOf(f);
          const isFocused = highlighted === path;
          const isSelected = effectiveSelected.has(path);
          const dir = path.includes("/")
            ? path.slice(0, path.lastIndexOf("/") + 1)
            : "";
          const base = path.includes("/")
            ? path.slice(path.lastIndexOf("/") + 1)
            : path;

          const rowClasses = [
            styles.row,
            isSelected ? styles.rowSelected : "",
            isFocused ? styles.rowFocused : "",
          ]
            .filter(Boolean)
            .join(" ");

          // When the row being dragged is part of the active multi-selection,
          // bundle every selected path; otherwise just the row's own path.
          const dragPaths =
            isSelected && effectiveSelected.size > 1
              ? Array.from(effectiveSelected)
              : [path];

          return (
            <FileRow
              key={path}
              path={path}
              dragPaths={dragPaths}
              isSelected={isSelected}
              className={rowClasses}
              onClick={(e) => handleRowClick(path, e)}
              onContextMenu={(e) => handleContextMenu(path, e)}
            >
              <span
                className={styles.stageToggle}
                onClick={(e) => handleStageToggle(f, e)}
                role="checkbox"
                aria-checked={f.staged === "full"}
                aria-label={
                  f.staged === "none" ? `Stage ${path}` : `Unstage ${path}`
                }
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    handleStageToggle(f, e as unknown as MouseEvent);
                  }
                }}
              >
                <span
                  className={`${styles.checkbox} ${stagedCheckboxClass(f.staged, styles)}`}
                  aria-hidden
                >
                  {f.staged === "full" && <Icons.CheckIcon size={9} />}
                  {f.staged === "partial" && (
                    <span className={styles.checkboxDash} />
                  )}
                </span>
              </span>
              <span
                className={`${styles.badge} ${styles[`badge_${badgeKindFor(f.status)}`]}`}
              >
                {f.status}
              </span>
              <span className={styles.filename}>
                {dir && <span className={styles.dir}>{dir}</span>}
                <span className={styles.base}>{base}</span>
              </span>
              {(() => {
                let add = 0;
                let del = 0;
                for (const hunk of f.hunks) {
                  for (const line of hunk.lines) {
                    if (line.type === "add") {
                      add++;
                    } else if (line.type === "remove") {
                      del++;
                    }
                  }
                }
                if (add === 0 && del === 0) {
                  return null;
                }

                return (
                  <span className={styles.stats}>
                    {add > 0 && <span className={styles.statAdd}>+{add}</span>}
                    {del > 0 && <span className={styles.statDel}>−{del}</span>}
                  </span>
                );
              })()}
            </FileRow>
          );
        })}
      </div>
    </div>
  );
}

interface FileRowProps {
  children: ReactNode;
  className: string;
  /** Paths to send in the drag payload (single row, or all selected rows). */
  dragPaths: string[];
  isSelected: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (e: MouseEvent<HTMLButtonElement>) => void;
  path: string;
}

/**
 * Single row in the working-copy file list. Extracted so each row can hold
 * its own drag source — drop the row onto the Stashes sidebar entry to stash
 * just the selected files.
 */
function FileRow({
  path,
  dragPaths,
  isSelected,
  className,
  onClick,
  onContextMenu,
  children,
}: FileRowProps) {
  const drag = useDraggable({ kind: "file", paths: dragPaths });

  return (
    <button
      {...drag}
      type="button"
      data-path={path}
      role="option"
      aria-selected={isSelected}
      className={className}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {children}
    </button>
  );
}
