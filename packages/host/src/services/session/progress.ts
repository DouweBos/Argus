import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";

/** How far a session's setup or removal has got, as plain counts. */
export interface SessionProgress {
  current: number;
  total: number;
  /** Set while `.argus.json` teardown commands run, before the removal. */
  phase?: "teardown";
  /** The running step's latest output line. */
  detail?: string | null;
}

const progressBySession = new Map<string, SessionProgress>();
const lastBroadcastAt = new Map<string, number>();

/** Typed clients refetch the whole list per broadcast, so keep these sparse. */
const BROADCAST_INTERVAL_MS = 2000;

/** Remember a session's progress so clients that poll the list can show it. */
export function setSessionProgress(
  sessionId: string,
  progress: SessionProgress,
): void {
  progressBySession.set(sessionId, progress);
  const now = Date.now();
  if (now - (lastBroadcastAt.get(sessionId) ?? 0) < BROADCAST_INTERVAL_MS) {
    return;
  }
  lastBroadcastAt.set(sessionId, now);
  emitHostEvent("session:progress", sessionId);
}

export function getSessionProgress(sessionId: string): SessionProgress | null {
  return progressBySession.get(sessionId) ?? null;
}

export function clearSessionProgress(sessionId: string): void {
  progressBySession.delete(sessionId);
  lastBroadcastAt.delete(sessionId);
}

/**
 * The last line a command printed, for showing that it is still alive.
 * Carriage returns count as line breaks so a redrawn progress line reads as
 * its latest state rather than every state glued together.
 */
export function lastOutputLine(output: string): string | null {
  const lines = output.split(/[\r\n]+/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line) {
      return line;
    }
  }

  return null;
}

/**
 * The directories whose entries are counted while a worktree is removed.
 * One level below the root, plus pnpm's virtual store, so a single huge
 * folder such as `node_modules` moves the count instead of being one tick.
 */
export async function countedDirs(root: string): Promise<string[]> {
  const dirs = [root];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return dirs;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(root, entry.name);
    dirs.push(dir);
    if (entry.name === "node_modules") {
      dirs.push(path.join(dir, ".pnpm"));
    }
  }

  return dirs;
}

/** Entries left across `dirs`; a directory that is already gone counts as 0. */
export async function countEntries(dirs: string[]): Promise<number> {
  const counts = await Promise.all(
    dirs.map(async (dir) => {
      try {
        return (await fs.promises.readdir(dir)).length;
      } catch {
        return 0;
      }
    }),
  );

  return counts.reduce((sum, n) => sum + n, 0);
}

/**
 * Report how much of a worktree is gone while something else deletes it.
 * Emits `session:delete_progress:{sessionId}`; call the returned function
 * once the removal has finished or failed.
 */
export async function trackDeleteProgress(
  sessionId: string,
  worktreePath: string,
  intervalMs = 1000,
): Promise<() => void> {
  const dirs = await countedDirs(worktreePath);
  const total = await countEntries(dirs);
  if (total === 0) {
    return () => {};
  }

  let current = 0;
  let stopped = false;
  let busy = false;
  const report = () => {
    const progress = { current, total };
    setSessionProgress(sessionId, progress);
    emitHostEvent(`session:delete_progress:${sessionId}`, progress);
  };
  report();

  const timer = setInterval(async () => {
    // A slow drive can take longer than the interval to list.
    if (busy) {
      return;
    }
    busy = true;
    const removed = total - (await countEntries(dirs));
    busy = false;
    if (stopped || removed <= current) {
      return;
    }
    current = removed;
    report();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
