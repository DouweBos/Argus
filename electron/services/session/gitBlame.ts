/**
 * Phase 4 H7 — `git_blame_file` IPC.
 *
 * Parses `git blame --porcelain` output into per-chunk metadata so the UI
 * can render a `BlameGutter` next to each line. Read-only — no lock.
 */

import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";

export interface BlameChunk {
  author: string;
  authorEmail: string;
  authorTime: number;
  commitHash: string;
  /** Optional file content for this chunk (one entry per line). */
  content?: string[];
  lineCount: number;
  lineStart: number;
  summary: string;
}

function sessionPath(id: string): string {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return ws.path;
}

export async function gitBlameFile(
  id: string,
  filePath: string,
  ref?: string,
): Promise<BlameChunk[]> {
  const wt = sessionPath(id);
  const args = ["blame", "--porcelain"];
  if (ref) {
    args.push(ref);
  }
  args.push("--", filePath);

  const raw = await git(wt, args);

  // Porcelain format groups info by commit. First line of each entry is:
  //   <hash> <orig-line> <final-line> [num-lines-in-group]
  // Followed by metadata lines, then a tab-prefixed line of file content.
  const meta = new Map<string, Partial<BlameChunk>>();
  const chunks: BlameChunk[] = [];

  const lines = raw.split("\n");
  let i = 0;
  let currentHash: string | null = null;
  let currentFinalLine = 0;
  let currentChunk: BlameChunk | null = null;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line) {
      i++;
      continue;
    }
    const headerMatch = line.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/);
    if (headerMatch) {
      currentHash = headerMatch[1]!;
      currentFinalLine = parseInt(headerMatch[3]!, 10);
      let info = meta.get(currentHash);
      if (!info) {
        info = {
          commitHash: currentHash,
          author: "",
          authorEmail: "",
          authorTime: 0,
          summary: "",
        };
        meta.set(currentHash, info);
      }
      i++;
      // Read metadata lines until we hit the tab-prefixed content line.
      while (i < lines.length) {
        const ml = lines[i]!;
        if (ml.startsWith("\t")) {
          break;
        }
        if (ml.startsWith("author ")) {
          info.author = ml.slice("author ".length);
        } else if (ml.startsWith("author-mail ")) {
          info.authorEmail = ml
            .slice("author-mail ".length)
            .replace(/^<|>$/g, "");
        } else if (ml.startsWith("author-time ")) {
          info.authorTime =
            parseInt(ml.slice("author-time ".length), 10) * 1000;
        } else if (ml.startsWith("summary ")) {
          info.summary = ml.slice("summary ".length);
        }
        i++;
      }
      // Now lines[i] is the tab-prefixed content line.
      const content = lines[i]?.replace(/^\t/, "") ?? "";
      // Coalesce consecutive lines from the same chunk if it's a continuation.
      if (
        currentChunk &&
        currentChunk.commitHash === currentHash &&
        currentChunk.lineStart + currentChunk.lineCount === currentFinalLine
      ) {
        currentChunk.lineCount += 1;
        currentChunk.content?.push(content);
      } else {
        currentChunk = {
          commitHash: currentHash,
          author: info.author ?? "",
          authorEmail: info.authorEmail ?? "",
          authorTime: info.authorTime ?? 0,
          summary: info.summary ?? "",
          lineStart: currentFinalLine,
          lineCount: 1,
          content: [content],
        };
        // numLines from the header indicates the length of the group; we
        // build chunk-by-line so we can collapse runs even across groups.
        // Reserve space if numLines > 1 by walking forward — handled by
        // future iterations re-entering this branch.
        chunks.push(currentChunk);
      }
      // If header advertised more lines, the next entries use abbreviated
      // headers (no metadata lines). Continue in outer loop.
      i++;
    } else {
      // Skip stray lines — defensive.
      i++;
    }
  }

  return chunks;
}
