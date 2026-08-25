/**
 * Unified-diff data model and parser — a port of Peacock's `lib/diff.ts`,
 * trimmed to the read-only subset the remote client needs.
 */

export interface DiffLine {
  content: string;
  newNum?: number;
  oldNum?: number;
  staged?: boolean;
  type: "add" | "context" | "no-newline" | "remove";
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
  newStart: number;
  oldStart: number;
  /** Raw patch text for this hunk (for `git apply`). */
  patch: string;
  staged?: boolean;
}

export interface DiffFile {
  /** Raw header lines for reconstructing patches. */
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
    let nextOld = 0;
    let nextNew = 0;

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
        nextOld = currentHunk.oldStart;
        nextNew = currentHunk.newStart;
        hunks.push(currentHunk);
        continue;
      }

      if (!currentHunk) {
        continue;
      }
      currentHunkLines.push(line);

      if (line.startsWith("+")) {
        currentHunk.lines.push({
          type: "add",
          content: line.slice(1),
          newNum: nextNew,
        });
        nextNew++;
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          type: "remove",
          content: line.slice(1),
          oldNum: nextOld,
        });
        nextOld++;
      } else if (line.startsWith(" ") || line === "") {
        currentHunk.lines.push({
          type: "context",
          content: line.slice(1),
          oldNum: nextOld,
          newNum: nextNew,
        });
        nextOld++;
        nextNew++;
      } else if (line.startsWith("\\")) {
        // Git's "\ No newline at end of file" marker — attach to the
        // preceding line rather than consuming a slot of its own.
        currentHunk.lines.push({
          type: "no-newline",
          content: line.slice(2),
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
