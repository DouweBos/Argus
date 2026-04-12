import styles from "./EditDiffView.module.css";

interface EditDiffViewProps {
  newString: string;
  oldString?: string;
}

interface DiffLine {
  content: string;
  lineNo?: number;
  type: "add" | "context" | "remove";
}

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

  // Find common prefix lines.
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  // Find common suffix lines (don't overlap with prefix).
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

  // Context: common prefix.
  for (let i = 0; i < prefixLen; i++) {
    result.push({ type: "context", content: oldLines[i], lineNo: lineNo++ });
  }

  // Removed lines (middle of old).
  const oldMiddleEnd = oldLines.length - suffixLen;
  for (let i = prefixLen; i < oldMiddleEnd; i++) {
    result.push({ type: "remove", content: oldLines[i], lineNo: lineNo++ });
  }

  // Added lines (middle of new).  Line numbers continue from the removal point.
  let addLineNo = prefixLen + 1;
  const newMiddleEnd = newLines.length - suffixLen;
  for (let i = prefixLen; i < newMiddleEnd; i++) {
    result.push({ type: "add", content: newLines[i], lineNo: addLineNo++ });
  }

  // Context: common suffix.
  const suffixStart = oldLines.length - suffixLen;
  for (let i = suffixStart; i < oldLines.length; i++) {
    result.push({ type: "context", content: oldLines[i], lineNo: lineNo++ });
  }

  return result;
}

/**
 * Build diff lines for a Write tool (entire content is new).
 */
function writeLines(content: string): DiffLine[] {
  return content.split("\n").map((line, i) => ({
    type: "add" as const,
    content: line,
    lineNo: i + 1,
  }));
}

export function EditDiffView({ oldString, newString }: EditDiffViewProps) {
  const lines =
    oldString != null
      ? computeDiffLines(oldString, newString)
      : writeLines(newString);

  return (
    <div className={styles.diff}>
      {lines.map((line, i) => (
        <div
          key={i}
          className={`${styles.line} ${lineTypeClassName(line.type)}`}
        >
          <span className={styles.lineNo}>
            {line.lineNo != null ? line.lineNo : ""}
          </span>
          <span className={styles.linePrefix}>{linePrefixChar(line.type)}</span>
          <span className={styles.lineContent}>{line.content}</span>
        </div>
      ))}
    </div>
  );
}
