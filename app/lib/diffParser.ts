// --- Types ---

export interface DiffLine {
  content: string;
  newNum?: number;
  oldNum?: number;
  staged?: boolean;
  type: "add" | "context" | "remove";
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
  newStart: number;
  oldStart: number;
  /** Raw patch text for this hunk (for git apply operations) */
  patch: string;
  staged?: boolean;
}

export interface DiffFile {
  /** Raw header lines for reconstructing patches */
  diffHeader: string;
  hunks: DiffHunk[];
  newPath: string;
  oldPath: string;
  staged: "full" | "none" | "partial";
  status: "A" | "D" | "M" | "R";
}

// --- Parser ---

export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const chunks = raw.split(/^diff --git /m);

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const lines = chunk.split("\n");

    let oldPath = "";
    let newPath = "";
    let bodyStart = 0;
    const headerLines: string[] = ["diff --git " + lines[0]];

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      if (j > 0 && !line.startsWith("@@")) {
        headerLines.push(line);
      }
      if (line.startsWith("--- ")) {
        oldPath = line.replace(/^--- (a\/)?/, "");
        if (oldPath === "/dev/null") oldPath = "";
      } else if (line.startsWith("+++ ")) {
        newPath = line.replace(/^\+\+\+ (b\/)?/, "");
        if (newPath === "/dev/null") newPath = "";
        bodyStart = j + 1;
        break;
      }
    }

    let status: DiffFile["status"];
    if (!oldPath || oldPath === "/dev/null") status = "A";
    else if (!newPath || newPath === "/dev/null") status = "D";
    else if (oldPath !== newPath) status = "R";
    else status = "M";

    const diffHeader = headerLines.join("\n");

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let currentHunkLines: string[] = [];

    for (let j = bodyStart; j < lines.length; j++) {
      const line = lines[j];
      const hunkMatch = line.match(
        /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/,
      );

      if (hunkMatch) {
        if (currentHunk) {
          currentHunk.patch =
            diffHeader + "\n" + currentHunkLines.join("\n") + "\n";
        }
        currentHunk = {
          header: line,
          oldStart: parseInt(hunkMatch[1], 10),
          newStart: parseInt(hunkMatch[2], 10),
          lines: [],
          patch: "",
        };
        currentHunkLines = [line];
        hunks.push(currentHunk);
        continue;
      }

      if (!currentHunk) continue;
      currentHunkLines.push(line);

      const lastLine = currentHunk.lines[currentHunk.lines.length - 1];
      const prevOld = lastLine?.oldNum ?? currentHunk.oldStart - 1;
      const prevNew = lastLine?.newNum ?? currentHunk.newStart - 1;

      if (line.startsWith("+")) {
        currentHunk.lines.push({
          type: "add",
          content: line.slice(1),
          newNum: prevNew + 1,
        });
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          type: "remove",
          content: line.slice(1),
          oldNum: prevOld + 1,
        });
      } else if (line.startsWith(" ") || line === "") {
        currentHunk.lines.push({
          type: "context",
          content: line.slice(1),
          oldNum: prevOld + 1,
          newNum: prevNew + 1,
        });
      }
    }

    if (currentHunk) {
      currentHunk.patch =
        diffHeader + "\n" + currentHunkLines.join("\n") + "\n";
    }

    files.push({
      oldPath,
      newPath,
      status,
      hunks,
      staged: "none",
      diffHeader,
    });
  }

  return files;
}

/** Merge staged info into files parsed from full diff */
export function mergeStaged(
  fullFiles: DiffFile[],
  stagedRaw: string,
): DiffFile[] {
  const stagedFiles = parseDiff(stagedRaw);
  const stagedMap = new Map<string, DiffFile>();
  for (const f of stagedFiles) {
    stagedMap.set(f.newPath || f.oldPath, f);
  }

  return fullFiles.map((file) => {
    const key = file.newPath || file.oldPath;
    const stagedFile = stagedMap.get(key);

    if (!stagedFile) {
      return { ...file, staged: "none" as const };
    }

    const stagedLineKeys = new Set<string>();
    for (const hunk of stagedFile.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== "context") {
          stagedLineKeys.add(
            `${line.type}:${line.oldNum ?? ""}:${line.newNum ?? ""}:${line.content}`,
          );
        }
      }
    }

    let allStaged = true;
    let anyStaged = false;

    const mergedHunks = file.hunks.map((hunk) => {
      let hunkAllStaged = true;
      let hunkAnyStaged = false;

      const mergedLines = hunk.lines.map((line) => {
        if (line.type === "context") return line;
        const lineKey = `${line.type}:${line.oldNum ?? ""}:${line.newNum ?? ""}:${line.content}`;
        const isStaged = stagedLineKeys.has(lineKey);
        if (isStaged) {
          anyStaged = true;
          hunkAnyStaged = true;
        } else {
          allStaged = false;
          hunkAllStaged = false;
        }
        return { ...line, staged: isStaged };
      });

      return {
        ...hunk,
        lines: mergedLines,
        staged: hunkAllStaged && hunkAnyStaged,
      };
    });

    if (!anyStaged) allStaged = false;

    return {
      ...file,
      hunks: mergedHunks,
      staged: allStaged
        ? ("full" as const)
        : anyStaged
          ? ("partial" as const)
          : ("none" as const),
    };
  });
}

/**
 * Build a valid unified diff patch containing only the selected lines from a hunk.
 *
 * For unselected lines:
 * - remove lines → converted to context (they stay in the working tree)
 * - add lines → omitted entirely (they don't exist in the base)
 */
export function buildPartialPatch(
  file: DiffFile,
  hunk: DiffHunk,
  selectedIndices: Set<number>,
): string {
  const patchLines: string[] = [];
  let oldCount = 0;
  let newCount = 0;

  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i];
    const isSelected = selectedIndices.has(i);

    if (line.type === "context") {
      patchLines.push(" " + line.content);
      oldCount++;
      newCount++;
    } else if (line.type === "remove") {
      if (isSelected) {
        patchLines.push("-" + line.content);
        oldCount++;
      } else {
        // Convert to context — line stays
        patchLines.push(" " + line.content);
        oldCount++;
        newCount++;
      }
    } else if (line.type === "add") {
      if (isSelected) {
        patchLines.push("+" + line.content);
        newCount++;
      }
      // Unselected adds are omitted entirely
    }
  }

  const hunkHeader = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
  return (
    file.diffHeader + "\n" + hunkHeader + "\n" + patchLines.join("\n") + "\n"
  );
}
