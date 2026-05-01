import type {
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";
import * as Icons from "../../icons/Icons";
import styles from "./FileTree.module.css";

export interface FileTreeLeaf {
  /** Full path (used as the stable id and selection key). */
  path: string;
  /** Display label (usually the basename). */
  label: string;
  /** Optional status badge text (e.g. "M", "A"). */
  status?: string;
  /** Status colour family applied to the badge. */
  statusKind?: "added" | "deleted" | "modified" | "renamed" | "untracked";
  /** Optional leading icon (overrides default file icon). */
  icon?: ReactNode;
}

export interface FileTreeBranch {
  /** Path prefix (joined segments). */
  path: string;
  /** Display label (segment name). */
  label: string;
  children: FileTreeNode[];
}

export type FileTreeNode = FileTreeBranch | FileTreeLeaf;

export function isLeaf(n: FileTreeNode): n is FileTreeLeaf {
  return !("children" in n);
}

export interface FileTreeProps {
  nodes: FileTreeNode[];
  /** Set of branch paths currently expanded. */
  expanded: Set<string>;
  /** Set of leaf paths currently selected. */
  selected: Set<string>;
  onToggleExpand: (path: string) => void;
  onSelect: (path: string, e: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (path: string, e: MouseEvent<HTMLButtonElement>) => void;
  /** Optional drag handlers for leaves (e.g. drag-to-stage). */
  onDragStart?: (path: string, e: DragEvent<HTMLButtonElement>) => void;
}

/**
 * Generic file-tree primitive used by the working-copy view in tree mode.
 * Renders nested `<button>` rows; consumer owns expansion + selection state.
 *
 * Accepts a list of `FileTreeNode`s (branch or leaf). Branches are
 * collapsible via chevron; leaves render a status badge if provided.
 */
export function FileTree({
  nodes,
  expanded,
  selected,
  onToggleExpand,
  onSelect,
  onContextMenu,
  onDragStart,
}: FileTreeProps) {
  return (
    <div className={styles.tree} role="tree">
      {nodes.map((n) => (
        <FileTreeRow
          key={n.path}
          node={n}
          depth={0}
          expanded={expanded}
          selected={selected}
          onToggleExpand={onToggleExpand}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          onDragStart={onDragStart}
        />
      ))}
    </div>
  );
}

interface RowProps {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  selected: Set<string>;
  onToggleExpand: (path: string) => void;
  onSelect: (path: string, e: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (path: string, e: MouseEvent<HTMLButtonElement>) => void;
  onDragStart?: (path: string, e: DragEvent<HTMLButtonElement>) => void;
}

function FileTreeRow({
  node,
  depth,
  expanded,
  selected,
  onToggleExpand,
  onSelect,
  onContextMenu,
  onDragStart,
}: RowProps) {
  const indentStyle: CSSProperties = { paddingLeft: `${8 + depth * 14}px` };

  if (isLeaf(node)) {
    const isSelected = selected.has(node.path);
    const badgeClass = node.statusKind
      ? styles[`badge_${node.statusKind}`]
      : "";

    return (
      <button
        type="button"
        role="treeitem"
        aria-selected={isSelected}
        draggable={Boolean(onDragStart)}
        className={`${styles.row} ${styles.leaf} ${isSelected ? styles.selected : ""}`}
        style={indentStyle}
        onClick={(e) => onSelect(node.path, e)}
        onContextMenu={(e) => onContextMenu?.(node.path, e)}
        onDragStart={(e) => onDragStart?.(node.path, e)}
      >
        <span className={styles.chevronSpacer} />
        {node.icon ?? <Icons.FileIcon className={styles.fileIcon} size={11} />}
        <span className={styles.label}>{node.label}</span>
        {node.status && (
          <span className={`${styles.badge} ${badgeClass}`}>{node.status}</span>
        )}
      </button>
    );
  }

  const isOpen = expanded.has(node.path);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowRight" && !isOpen) {
      e.preventDefault();
      onToggleExpand(node.path);
    } else if (e.key === "ArrowLeft" && isOpen) {
      e.preventDefault();
      onToggleExpand(node.path);
    }
  };

  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-expanded={isOpen}
        className={`${styles.row} ${styles.branch}`}
        style={indentStyle}
        onClick={() => onToggleExpand(node.path)}
        onKeyDown={onKey}
      >
        <span className={styles.chevron}>
          {isOpen ? (
            <Icons.ChevronDownIcon size={9} />
          ) : (
            <Icons.ChevronRightIcon size={8} />
          )}
        </span>
        <Icons.FolderIcon className={styles.folderIcon} size={12} />
        <span className={styles.label}>{node.label}</span>
      </button>
      {isOpen &&
        node.children.map((c) => (
          <FileTreeRow
            key={c.path}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            selected={selected}
            onToggleExpand={onToggleExpand}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
          />
        ))}
    </>
  );
}

/**
 * Build a `FileTreeNode[]` from a flat list of `{ path, ... }` entries.
 * Single-child folder chains are collapsed into one row (`a/b/c`).
 */
export function buildFileTree(
  entries: Omit<FileTreeLeaf, "label">[],
  options?: { collapseSingles?: boolean },
): FileTreeNode[] {
  interface RawBranch {
    [key: string]: FileTreeLeaf | RawBranch;
  }
  const root: RawBranch = {};
  for (const entry of entries) {
    const segs = entry.path.split("/").filter(Boolean);
    let cursor: RawBranch = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i]!;
      const existing = cursor[seg];
      if (!existing || (existing as FileTreeLeaf).path !== undefined) {
        const next: RawBranch = {};
        cursor[seg] = next;
        cursor = next;
      } else {
        cursor = existing as RawBranch;
      }
    }
    const file = segs[segs.length - 1] ?? entry.path;
    cursor[file] = { ...entry, label: file };
  }

  const collapse = options?.collapseSingles ?? true;
  function toNodes(branch: RawBranch, prefix: string): FileTreeNode[] {
    const out: FileTreeNode[] = [];
    const keys = Object.keys(branch).sort((a, b) => {
      const av = branch[a]!;
      const bv = branch[b]!;
      const aLeaf = (av as FileTreeLeaf).path !== undefined;
      const bLeaf = (bv as FileTreeLeaf).path !== undefined;
      if (aLeaf !== bLeaf) {
        return aLeaf ? 1 : -1;
      }

      return a.localeCompare(b);
    });
    for (const key of keys) {
      const value = branch[key]!;
      const childPath = prefix ? `${prefix}/${key}` : key;
      if ((value as FileTreeLeaf).path !== undefined) {
        out.push(value as FileTreeLeaf);
      } else {
        let nested = value as RawBranch;
        let label = key;
        let path = childPath;
        if (collapse) {
          while (true) {
            const nestedKeys = Object.keys(nested);
            if (nestedKeys.length !== 1) {
              break;
            }
            const onlyKey = nestedKeys[0]!;
            const only = nested[onlyKey]!;
            if ((only as FileTreeLeaf).path !== undefined) {
              break;
            }
            label = `${label}/${onlyKey}`;
            path = `${path}/${onlyKey}`;
            nested = only as RawBranch;
          }
        }
        out.push({
          label,
          path,
          children: toNodes(nested, path),
        });
      }
    }

    return out;
  }

  return toNodes(root, "");
}
