/**
 * Turns a path as an agent wrote it into one `files.read` accepts: relative to
 * the session's worktree. A client doesn't know where the worktree lives, so
 * an absolute path is matched against the session's file list by suffix. The
 * TS twin of ArgusCore's `SessionFilePaths`.
 */

/** Absolute and `~/` paths can only be placed with the session's file list. */
export function needsFileList(raw: string): boolean {
  const path = raw.trim();

  return path.startsWith("/") || path.startsWith("~");
}

/** `./a/../b.ts` → `b.ts`; null when it climbs out of the worktree. */
export function normalizeRelativePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length === 0) {
        return null;
      }
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.length === 0 ? null : parts.join("/");
}

/** The worktree-relative path, or null when `raw` can't name a file in this session. */
export function relativeSessionPath(
  raw: string,
  files: readonly string[],
): string | null {
  const path = raw.trim();
  if (!path) {
    return null;
  }
  if (needsFileList(path)) {
    let best: string | null = null;
    for (const file of files) {
      if (
        (path === file || path.endsWith(`/${file}`)) &&
        file.length > (best?.length ?? -1)
      ) {
        best = file;
      }
    }

    return best;
  }

  return normalizeRelativePath(path);
}

/** The last path component, for titles. */
export function fileNameOf(path: string): string {
  const parts = path.split("/").filter(Boolean);

  return parts.at(-1) ?? path;
}

/** Everything before the file name, for subtitles; empty at the worktree root. */
export function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");

  return slash === -1 ? "" : path.slice(0, slash);
}
