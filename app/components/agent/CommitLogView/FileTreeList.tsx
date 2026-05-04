import type { DiffFile } from "../../../lib/diffParser";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { Icons } from "@argus/peacock";
import { FileDiffView } from "../FileDiffView";
import styles from "../HistoryView/HistoryView.module.css";
import { statusLabel } from "./utils";

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

export interface FileTreeListProps {
  diffFiles: DiffFile[];
  expandedFiles: Set<number>;
  fileStats: { adds: number; dels: number }[];
  onToggle: (i: number) => void;
  sessionId: string;
}

export function FileTreeList({
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
