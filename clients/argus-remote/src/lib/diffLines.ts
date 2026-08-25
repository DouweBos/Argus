/**
 * Line-level diff for Edit/Write tool previews — a port of Peacock's DiffView
 * math (prefix/suffix context matching), without the DOM rendering.
 */

export interface EditDiffLine {
  content: string;
  lineNo?: number;
  type: "add" | "context" | "remove";
}

function matchEdges(
  oldLines: string[],
  newLines: string[],
): { prefixLen: number; suffixLen: number } {
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

  return { prefixLen, suffixLen };
}

export function computeDiffLines(
  oldStr: string,
  newStr: string,
): EditDiffLine[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const { prefixLen, suffixLen } = matchEdges(oldLines, newLines);

  const result: EditDiffLine[] = [];
  let lineNo = 1;

  for (let i = 0; i < prefixLen; i++) {
    result.push({ type: "context", content: oldLines[i], lineNo: lineNo++ });
  }
  for (let i = prefixLen; i < oldLines.length - suffixLen; i++) {
    result.push({ type: "remove", content: oldLines[i], lineNo: lineNo++ });
  }
  let addLineNo = prefixLen + 1;
  for (let i = prefixLen; i < newLines.length - suffixLen; i++) {
    result.push({ type: "add", content: newLines[i], lineNo: addLineNo++ });
  }
  for (let i = oldLines.length - suffixLen; i < oldLines.length; i++) {
    result.push({ type: "context", content: oldLines[i], lineNo: lineNo++ });
  }

  return result;
}

/** Every line of a Write is new content. */
export function writeLines(content: string): EditDiffLine[] {
  return content.split("\n").map((line, i) => ({
    type: "add" as const,
    content: line,
    lineNo: i + 1,
  }));
}

export function computeDiffStats(
  oldStr: string,
  newStr: string,
): { additions: number; deletions: number } {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const { prefixLen, suffixLen } = matchEdges(oldLines, newLines);

  return {
    additions: newLines.length - prefixLen - suffixLen,
    deletions: oldLines.length - prefixLen - suffixLen,
  };
}
