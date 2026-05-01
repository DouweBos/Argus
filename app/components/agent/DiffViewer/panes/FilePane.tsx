import type { FileTreeLeaf } from "@argus/peacock";
import {
  type DragEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { FileTree, Icons, buildFileTree } from "@argus/peacock";
import { type DiffFile, gitIndexPath } from "../../../../lib/diffParser";
import {
  toggleExpandedFolder,
  useExpandedFolders,
} from "../../../../stores/gitUiStore";
import paneStyles from "./FilePane.module.css";

export type WorkingCopyView = "flat" | "tree";

export type PaneKind = "staged" | "unstaged";

export interface FilePaneProps {
  active: boolean;
  files: DiffFile[];
  /** Path of the file the diff detail should display. */
  highlighted: string | null;
  kind: PaneKind;
  onActivate: () => void;
  onContextMenu: (path: string, x: number, y: number) => void;
  onDropPaths: (paths: string[]) => void;
  onSelect: (next: Set<string>, highlight: string) => void;
  /** When the user presses Enter on a row. */
  onTrigger?: (path: string) => void;
  searchQuery: string;
  /** Selected paths within this pane. */
  selected: Set<string>;
  sessionId: string;
  view: WorkingCopyView;
}

function pathOf(f: DiffFile): string {
  return gitIndexPath(f);
}

function badgeKindFor(status: string): FileTreeLeaf["statusKind"] {
  switch (status) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "M":
      return "modified";
    default:
      return "modified";
  }
}

const DRAG_MIME = "application/x-argus-files";

/**
 * One side of the working-copy three-pane layout (Unstaged or Staged).
 * Owns its own selection, drag source, and drop target.
 */
export function FilePane({
  kind,
  files,
  view,
  active,
  selected,
  highlighted,
  sessionId,
  searchQuery,
  onSelect,
  onActivate,
  onContextMenu,
  onDropPaths,
  onTrigger,
}: FilePaneProps): ReactNode {
  const [dragOver, setDragOver] = useState(false);
  const expanded = useExpandedFolders(sessionId);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? files.filter((f) => pathOf(f).toLowerCase().includes(q))
      : files;

    // Stable sort by path
    return [...list].sort((a, b) => pathOf(a).localeCompare(pathOf(b)));
  }, [files, searchQuery]);

  const lastClickedRef = useRef<string | null>(null);

  const handleSelect = useCallback(
    (path: string, e: MouseEvent<HTMLButtonElement>) => {
      onActivate();
      const meta = e.metaKey || e.ctrlKey;
      if (e.shiftKey && lastClickedRef.current) {
        // Range selection within current filtered list
        const paths = filtered.map(pathOf);
        const a = paths.indexOf(lastClickedRef.current);
        const b = paths.indexOf(path);
        if (a >= 0 && b >= 0) {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const next = new Set(selected);
          for (let i = lo; i <= hi; i++) {
            next.add(paths[i]!);
          }
          onSelect(next, path);

          return;
        }
      }
      if (meta) {
        const next = new Set(selected);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        lastClickedRef.current = path;
        onSelect(next, path);

        return;
      }
      lastClickedRef.current = path;
      onSelect(new Set([path]), path);
    },
    [filtered, onActivate, onSelect, selected],
  );

  const handleContextMenu = useCallback(
    (path: string, e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      // If the right-click target isn't in the current selection, narrow to it.
      if (!selected.has(path)) {
        onSelect(new Set([path]), path);
      }
      onContextMenu(path, e.clientX, e.clientY);
    },
    [onContextMenu, onSelect, selected],
  );

  const handleDragStart = useCallback(
    (path: string, e: DragEvent<HTMLButtonElement>) => {
      // Multi-drag: if the dragged row is selected, drag everything selected
      const paths = selected.has(path) ? [...selected] : [path];
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(paths));
      e.dataTransfer.setData("text/plain", paths.join("\n"));
      e.dataTransfer.effectAllowed = "move";
    },
    [selected],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) {
        return;
      }
      try {
        const list = JSON.parse(raw) as string[];
        if (Array.isArray(list) && list.length > 0) {
          onDropPaths(list);
        }
      } catch {
        // ignore
      }
    },
    [onDropPaths],
  );

  const heading = kind === "staged" ? "Staged" : "Unstaged";
  const headingClass = `${paneStyles.header} ${active ? paneStyles.headerActive : ""}`;

  let body: ReactNode;
  if (filtered.length === 0) {
    body = (
      <div className={paneStyles.empty}>
        <Icons.FileIcon size={20} />
        <span>{kind === "staged" ? "Nothing staged" : "No changes"}</span>
      </div>
    );
  } else if (view === "tree") {
    const leaves: Omit<FileTreeLeaf, "label">[] = filtered.map((f) => ({
      path: pathOf(f),
      status: f.status,
      statusKind: badgeKindFor(f.status),
    }));
    const nodes = buildFileTree(leaves);
    body = (
      <div className={paneStyles.scroll}>
        <FileTree
          nodes={nodes}
          expanded={expanded}
          selected={highlighted ? new Set([highlighted]) : new Set()}
          onToggleExpand={(path) => toggleExpandedFolder(sessionId, path)}
          onSelect={handleSelect}
          onContextMenu={handleContextMenu}
          onDragStart={handleDragStart}
        />
      </div>
    );
  } else {
    body = (
      <div className={paneStyles.scroll}>
        {filtered.map((f) => {
          const path = pathOf(f);
          const isSelected = selected.has(path);
          const isHighlighted = highlighted === path;

          return (
            <button
              key={path}
              type="button"
              draggable
              className={`${paneStyles.row} ${isSelected ? paneStyles.rowSelected : ""} ${isHighlighted ? paneStyles.rowHighlighted : ""}`}
              onClick={(e) => handleSelect(path, e)}
              onContextMenu={(e) => handleContextMenu(path, e)}
              onDragStart={(e) => handleDragStart(path, e)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && onTrigger) {
                  onTrigger(path);
                }
              }}
            >
              <span
                className={`${paneStyles.badge} ${paneStyles[`badge_${badgeKindFor(f.status)}`]}`}
              >
                {f.status}
              </span>
              <span className={paneStyles.path}>{path}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <section
      className={`${paneStyles.pane} ${active ? paneStyles.paneActive : ""} ${dragOver ? paneStyles.paneDropping : ""}`}
      onMouseDown={onActivate}
      onFocusCapture={onActivate}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <header className={headingClass}>
        <span className={paneStyles.headerTitle}>{heading}</span>
        <span className={paneStyles.headerCount}>{filtered.length}</span>
      </header>
      {body}
    </section>
  );
}
