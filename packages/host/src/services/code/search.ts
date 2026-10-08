/**
 * Search across a worktree with the bundled ripgrep. Matches stream out as
 * `code:search:<searchId>` batches and end with one `done` — after a natural
 * finish, hitting `maxResults`, a cancel, or the client going away.
 */

import type {
  CodeSearchEvent,
  CodeSearchMatch,
  CodeSearchQuery,
} from "@argus/remote-protocol";
import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import readline from "node:readline";
import { emitHostEvent } from "@argus/host/bus";
import { onConnectionClose } from "../remote/connectionScope";
import { ripgrepPath } from "./bundled";
import { sessionRoot } from "./paths";

export const DEFAULT_MAX_RESULTS = 2000;
export const MAX_RESULTS_CAP = 20_000;
/** UTF-16 units of line shown around a match. */
export const PREVIEW_LENGTH = 240;
/** How much of the line before the match a preview keeps. */
const PREVIEW_LEAD = 40;
const BATCH_SIZE = 100;
const BATCH_MS = 50;

interface RunningSearch {
  sessionId: string;
  child: ChildProcess;
  cancelled: boolean;
}

const searches = new Map<string, RunningSearch>();

/** rg's text or bytes field. */
interface RgData {
  text?: string;
  bytes?: string;
}

interface RgMatch {
  type: "match";
  data: {
    path: RgData;
    lines: RgData;
    line_number: number | null;
    submatches: { start: number; end: number }[];
  };
}

function decode(data: RgData): Buffer {
  return data.text !== undefined
    ? Buffer.from(data.text, "utf8")
    : Buffer.from(data.bytes ?? "", "base64");
}

/** UTF-16 length of the first `bytes` bytes of a UTF-8 line. */
function utf16At(line: Buffer, bytes: number): number {
  return line.subarray(0, bytes).toString("utf8").length;
}

export function toMatches(event: RgMatch): CodeSearchMatch[] {
  const relativePath = decode(event.data.path)
    .toString("utf8")
    .replace(/^\.\//, "");
  const raw = decode(event.data.lines);
  const text = raw.toString("utf8").replace(/\r?\n$/, "");

  return event.data.submatches.map((sub) => {
    const column = utf16At(raw, sub.start);
    const length = utf16At(raw, sub.end) - column;
    const previewOffset =
      text.length <= PREVIEW_LENGTH ? 0 : Math.max(0, column - PREVIEW_LEAD);

    return {
      relativePath,
      line: event.data.line_number ?? 0,
      column,
      length,
      preview: text.slice(previewOffset, previewOffset + PREVIEW_LENGTH),
      previewOffset,
    };
  });
}

export function ripgrepArgs(query: CodeSearchQuery): string[] {
  const args = [
    "--json",
    "--no-config",
    "--hidden",
    "--glob",
    "!.git",
    "--max-filesize",
    "5M",
    query.caseSensitive ? "--case-sensitive" : "--ignore-case",
  ];
  if (!query.regex) {
    args.push("--fixed-strings");
  }
  if (query.wholeWord) {
    args.push("--word-regexp");
  }
  for (const glob of query.include ?? []) {
    args.push("--glob", glob);
  }
  for (const glob of query.exclude ?? []) {
    args.push("--glob", `!${glob}`);
  }
  args.push("--regexp", query.query, ".");

  return args;
}

function emit(searchId: string, event: CodeSearchEvent): void {
  emitHostEvent(`code:search:${searchId}`, event);
}

export function startCodeSearch(
  id: string,
  query: CodeSearchQuery,
  requestedId?: string,
): { searchId: string } {
  const cwd = sessionRoot(id);
  const searchId = requestedId ?? crypto.randomUUID();
  if (searches.has(searchId)) {
    throw `Search already running: ${searchId}`;
  }
  const max = Math.min(
    query.maxResults ?? DEFAULT_MAX_RESULTS,
    MAX_RESULTS_CAP,
  );
  const child = spawn(ripgrepPath(), ripgrepArgs(query), {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const search: RunningSearch = { sessionId: id, child, cancelled: false };
  searches.set(searchId, search);
  const releaseOnClose = onConnectionClose(() => cancelCodeSearch(searchId));

  let count = 0;
  let truncated = false;
  let pending: CodeSearchMatch[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stderr = "";
  let spawnError: string | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length > 0) {
      emit(searchId, { kind: "matches", searchId, matches: pending });
      pending = [];
    }
  };

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    if (truncated || search.cancelled || !line.includes('"type":"match"')) {
      return;
    }
    let parsed: RgMatch;
    try {
      parsed = JSON.parse(line) as RgMatch;
    } catch {
      return;
    }
    for (const match of toMatches(parsed)) {
      if (count >= max) {
        truncated = true;
        child.kill();
        break;
      }
      pending.push(match);
      count += 1;
    }
    if (pending.length >= BATCH_SIZE) {
      flush();
    } else if (!timer) {
      timer = setTimeout(flush, BATCH_MS);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 2000) {
      stderr += chunk.toString("utf8");
    }
  });
  child.once("error", (err) => {
    spawnError = `Could not run ripgrep: ${err.message}`;
  });
  child.once("close", (code) => {
    flush();
    releaseOnClose();
    searches.delete(searchId);
    // 0: matches, 1: none, 2: an error (possibly alongside matches).
    const failed = !truncated && !search.cancelled && code !== 0 && code !== 1;
    const error =
      spawnError ??
      (failed ? stderr.trim().split("\n")[0] || `rg exited ${code}` : null);
    emit(searchId, {
      kind: "done",
      searchId,
      count,
      truncated,
      cancelled: search.cancelled,
      ...(error ? { error: error.slice(0, 300) } : {}),
    });
  });

  return { searchId };
}

export function cancelCodeSearch(searchId: string): void {
  const search = searches.get(searchId);
  if (!search) {
    return;
  }
  search.cancelled = true;
  search.child.kill();
}

/** The session a running search belongs to, or null. */
export function codeSearchSession(searchId: string): string | null {
  return searches.get(searchId)?.sessionId ?? null;
}

export function stopCodeSearches(sessionId?: string): void {
  for (const [searchId, search] of searches) {
    if (!sessionId || search.sessionId === sessionId) {
      cancelCodeSearch(searchId);
    }
  }
}
