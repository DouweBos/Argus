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

/**
 * Path to pass to `git add` / `git reset` for this entry.
 * Deletes reference the old path; renames and edits use the new tree path.
 */
export function gitIndexPath(file: DiffFile): string {
  if (file.status === "D") {
    return file.oldPath;
  }

  if (file.newPath) {
    return file.newPath;
  }

  return file.oldPath;
}

// --- Parser ---

/** Paths from the line after `diff --git ` (e.g. `a/foo b/foo`). */
function parsePathsFromDiffGitLine(line: string): {
  newPath: string;
  oldPath: string;
} {
  const trimmed = line.trim();
  if (!trimmed) {
    return { oldPath: "", newPath: "" };
  }

  // Quoted paths (spaces / special chars)
  if (trimmed.startsWith('"')) {
    const m = trimmed.match(/^"a\/((?:[^"\\]|\\.)+)" "b\/((?:[^"\\]|\\.)+)"/);
    if (m) {
      const unescape = (s: string) => s.replace(/\\(.)/g, "$1");

      return { oldPath: unescape(m[1]), newPath: unescape(m[2]) };
    }
  }

  const bAt = trimmed.indexOf(" b/");
  if (bAt !== -1 && trimmed.startsWith("a/")) {
    return {
      oldPath: trimmed.slice(2, bAt),
      newPath: trimmed.slice(bAt + 3),
    };
  }

  return { oldPath: "", newPath: "" };
}

function pathFromBinaryToken(token: string): string {
  const t = token.trim();
  if (t === "/dev/null") {
    return "";
  }

  if (t.startsWith("a/") || t.startsWith("b/") || t.startsWith("c/")) {
    return t.slice(2);
  }

  return t;
}

/** Strip optional double-quotes from `git diff` path tokens. */
function unquoteGitPath(token: string): string {
  const t = token.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(.)/g, "$1");
  }

  return t;
}

/** When git omits ---/+++ (e.g. binary-only diffs), paths still appear here. */
function parsePathsFromBinaryFilesLine(line: string): {
  newPath: string;
  oldPath: string;
} | null {
  const m = line.match(/^Binary files (.+) and (.+) differ$/);
  if (!m) {
    return null;
  }

  return {
    oldPath: pathFromBinaryToken(m[1]),
    newPath: pathFromBinaryToken(m[2]),
  };
}

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
        if (oldPath === "/dev/null") {
          oldPath = "";
        }
      } else if (line.startsWith("+++ ")) {
        newPath = line.replace(/^\+\+\+ (b\/)?/, "");
        if (newPath === "/dev/null") {
          newPath = "";
        }
        bodyStart = j + 1;
        break;
      }
    }

    if (!oldPath && !newPath) {
      const fromGit = parsePathsFromDiffGitLine(lines[0] ?? "");
      oldPath = fromGit.oldPath;
      newPath = fromGit.newPath;
    }

    if (!oldPath && !newPath) {
      for (const line of lines) {
        const fromBin = parsePathsFromBinaryFilesLine(line);
        if (fromBin) {
          oldPath = fromBin.oldPath;
          newPath = fromBin.newPath;
          break;
        }
      }
    }

    let renameFrom = "";
    let renameTo = "";
    for (const line of lines) {
      if (line.startsWith("rename from ")) {
        renameFrom = unquoteGitPath(line.slice("rename from ".length));
      } else if (line.startsWith("rename to ")) {
        renameTo = unquoteGitPath(line.slice("rename to ".length));
      }
    }

    if (!oldPath && renameFrom) {
      oldPath = renameFrom;
    }

    if (!newPath && renameTo) {
      newPath = renameTo;
    }

    let status: DiffFile["status"];
    if (!oldPath || oldPath === "/dev/null") {
      status = "A";
    } else if (!newPath || newPath === "/dev/null") {
      status = "D";
    } else if (oldPath !== newPath) {
      status = "R";
    } else {
      status = "M";
    }

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

      if (!currentHunk) {
        continue;
      }
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

/** Same change identity in the index (paths + status) for file-level staging. */
function sameDiffIdentity(a: DiffFile, b: DiffFile): boolean {
  if (a.status !== b.status) {
    return false;
  }

  switch (a.status) {
    case "R":
      return a.oldPath === b.oldPath && a.newPath === b.newPath;
    case "M":
      return a.oldPath === b.oldPath && a.newPath === b.newPath;
    case "D":
      return a.oldPath === b.oldPath;
    case "A":
      return a.newPath === b.newPath;
  }
}

/**
 * When `git diff HEAD` has no @@ hunks (pure rename, binary, etc.), line-level
 * merge cannot run. Infer staged state from the cached diff shape.
 *
 * Notably: if you stage the new path before the old deletion, `git diff HEAD`
 * may still show a single rename with no hunk lines, while `git diff --cached`
 * shows the new path as an added file — sameDiffIdentity is false (R vs A).
 */
function mergeStagedEmptyHunkFile(
  file: DiffFile,
  stagedFile: DiffFile,
): Pick<DiffFile, "hunks" | "staged"> {
  if (stagedFile.hunks.length === 0) {
    return {
      hunks: file.hunks,
      staged: sameDiffIdentity(file, stagedFile) ? "full" : "none",
    };
  }

  if (
    file.status === "R" &&
    stagedFile.status === "A" &&
    stagedFile.newPath === file.newPath
  ) {
    return { hunks: file.hunks, staged: "partial" };
  }

  return { hunks: file.hunks, staged: "none" };
}

/** Merge staged info into files parsed from full diff */
export function mergeStaged(
  fullFiles: DiffFile[],
  stagedRaw: string,
): DiffFile[] {
  const stagedFiles = parseDiff(stagedRaw);
  const stagedMap = new Map<string, DiffFile>();
  for (const f of stagedFiles) {
    const k = f.newPath || f.oldPath;
    stagedMap.set(k, f);
    if (f.status === "R" && f.oldPath && f.newPath) {
      stagedMap.set(f.oldPath, f);
      stagedMap.set(f.newPath, f);
    }
  }

  return fullFiles.map((file) => {
    const key = file.newPath || file.oldPath;
    let stagedFile = stagedMap.get(key);
    if (!stagedFile && file.status === "R") {
      stagedFile =
        stagedMap.get(file.oldPath) ?? stagedMap.get(file.newPath) ?? undefined;
    }

    if (!stagedFile) {
      return { ...file, staged: "none" as const };
    }

    if (file.hunks.length === 0) {
      return { ...file, ...mergeStagedEmptyHunkFile(file, stagedFile) };
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
        if (line.type === "context") {
          return line;
        }
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

    if (!anyStaged) {
      allStaged = false;
    }

    let staged: "full" | "none" | "partial";
    if (allStaged) {
      staged = "full";
    } else if (anyStaged) {
      staged = "partial";
    } else {
      staged = "none";
    }

    return {
      ...file,
      hunks: mergedHunks,
      staged,
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
