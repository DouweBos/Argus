import { useState } from "react";
import styles from "./DiffView.module.css";

export interface DiffViewProps {
  newString: string;
  /** When omitted, the whole `newString` renders as added lines (Write). */
  oldString?: string;
}

interface DiffLine {
  content: string;
  lineNo?: number;
  type: "add" | "context" | "remove";
}

const COLLAPSED_LINE_COUNT = 12;

function lineTypeClassName(type: DiffLine["type"]): string {
  if (type === "add") {
    return styles.lineAdd;
  }
  if (type === "remove") {
    return styles.lineRemove;
  }

  return "";
}

function linePrefixChar(type: DiffLine["type"]): string {
  if (type === "add") {
    return "+";
  }
  if (type === "remove") {
    return "-";
  }

  return " ";
}

/**
 * Compute a simple line-level diff between two strings.
 *
 * Finds matching context lines at the start and end so the user
 * sees the change in context rather than a raw red/green block.
 */
function computeDiffLines(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] ===
      newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const result: DiffLine[] = [];
  let lineNo = 1;

  for (let i = 0; i < prefixLen; i++) {
    result.push({ type: "context", content: oldLines[i], lineNo: lineNo++ });
  }

  const oldMiddleEnd = oldLines.length - suffixLen;
  for (let i = prefixLen; i < oldMiddleEnd; i++) {
    result.push({ type: "remove", content: oldLines[i], lineNo: lineNo++ });
  }

  let addLineNo = prefixLen + 1;
  const newMiddleEnd = newLines.length - suffixLen;
  for (let i = prefixLen; i < newMiddleEnd; i++) {
    result.push({ type: "add", content: newLines[i], lineNo: addLineNo++ });
  }

  const suffixStart = oldLines.length - suffixLen;
  for (let i = suffixStart; i < oldLines.length; i++) {
    result.push({ type: "context", content: oldLines[i], lineNo: lineNo++ });
  }

  return result;
}

/** Build diff lines for a Write tool (entire content is new). */
function writeLines(content: string): DiffLine[] {
  return content.split("\n").map((line, i) => ({
    type: "add" as const,
    content: line,
    lineNo: i + 1,
  }));
}

/**
 * Pure line-diff renderer with context collapsing. Used for Edit / Write /
 * MultiEdit tool calls across desktop and web.
 */
export function DiffView({ oldString, newString }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false);

  const lines =
    oldString != null
      ? computeDiffLines(oldString, newString)
      : writeLines(newString);

  const overflows = lines.length > COLLAPSED_LINE_COUNT;
  const collapsed = overflows && !expanded;
  const visibleLines = collapsed ? lines.slice(0, COLLAPSED_LINE_COUNT) : lines;

  return (
    <div className={styles.wrapper}>
      <div className={styles.diff}>
        {visibleLines.map((line, i) => (
          <div
            key={i}
            className={`${styles.line} ${lineTypeClassName(line.type)}`}
          >
            <span className={styles.lineNo}>
              {line.lineNo != null ? line.lineNo : ""}
            </span>
            <span className={styles.linePrefix}>
              {linePrefixChar(line.type)}
            </span>
            <span className={styles.lineContent}>{line.content}</span>
          </div>
        ))}
      </div>
      {collapsed && (
        <div className={styles.overlay}>
          <button
            type="button"
            className={styles.seeAll}
            onClick={() => setExpanded(true)}
          >
            See all {lines.length} lines
          </button>
        </div>
      )}
      {overflows && expanded && (
        <div className={styles.collapseBar}>
          <button
            type="button"
            className={styles.seeAll}
            onClick={() => setExpanded(false)}
          >
            Collapse
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Count additions/deletions for an Edit — mirrors DiffView's prefix/suffix
 * logic, exposed for headers/summaries.
 */
export function computeDiffStats(
  oldStr: string,
  newStr: string,
): { additions: number; deletions: number } {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] ===
      newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  return {
    additions: newLines.length - prefixLen - suffixLen,
    deletions: oldLines.length - prefixLen - suffixLen,
  };
}
