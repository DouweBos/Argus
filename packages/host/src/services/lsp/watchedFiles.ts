/**
 * Keeps servers current on files the editor doesn't have open — the ones
 * agents rewrite while you read something else. Rides the session's existing
 * change signals (the diff poller, the git runner watch, the editor's own
 * saves) and, only for sessions with a live server, diffs one `git status`
 * against the last one into `workspace/didChangeWatchedFiles`.
 */

import fs from "node:fs";
import path from "node:path";
import { DidChangeWatchedFilesNotification } from "vscode-languageserver-protocol/node";
import { addHostEventSink } from "@argus/host/bus";
import { onCodeFileWritten } from "../code/files";
import { canonicalSessionRoot, clientPath } from "../code/paths";
import { git } from "../session/git";
import { toUri } from "./convert";
import { readyHandles, stopLanguageServers } from "./manager";

export const WATCHED_FILES_DEBOUNCE_MS = 500;

const CREATED = 1;
const CHANGED = 2;
const DELETED = 3;

interface FileEvent {
  uri: string;
  type: number;
}

/** Path → mtime (null: gone) of what `git status` listed last time. */
const snapshots = new Map<string, Map<string, number | null>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function notify(sessionId: string, events: FileEvent[]): void {
  if (events.length === 0) {
    return;
  }
  for (const handle of readyHandles(sessionId)) {
    const open = new Set([...handle.docs.values()].map((d) => d.uri));
    const changes = events.filter((e) => !open.has(e.uri));
    if (changes.length > 0) {
      handle.proc?.notify(DidChangeWatchedFilesNotification.type, { changes });
    }
  }
}

function parseStatus(out: string): string[] {
  const paths: string[] = [];
  const entries = out.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) {
      continue;
    }
    paths.push(entry.slice(3));
    // A rename's original path follows as its own entry.
    if (entry[0] === "R" || entry[0] === "C") {
      i += 1;
    }
  }

  return paths;
}

async function mtimeOf(file: string): Promise<number | null> {
  try {
    return (await fs.promises.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

async function refresh(sessionId: string): Promise<void> {
  if (readyHandles(sessionId).length === 0) {
    snapshots.delete(sessionId);

    return;
  }
  let root: string;
  try {
    root = canonicalSessionRoot(sessionId);
  } catch {
    return;
  }
  const out = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]).catch(() => null);
  if (out === null) {
    return;
  }
  const next = new Map<string, number | null>();
  for (const rel of parseStatus(out)) {
    next.set(rel, await mtimeOf(path.join(root, rel)));
  }
  const previous = snapshots.get(sessionId);
  snapshots.set(sessionId, next);
  // The first look is the baseline: nothing to compare it with.
  if (!previous) {
    return;
  }
  const events: FileEvent[] = [];
  for (const [rel, mtime] of next) {
    if (previous.get(rel) !== mtime) {
      let type = previous.has(rel) ? CHANGED : CREATED;
      if (mtime === null) {
        type = DELETED;
      }
      events.push({ uri: toUri(path.join(root, rel)), type });
    }
  }
  // Dropped out of status: committed, reverted, or deleted.
  for (const rel of previous.keys()) {
    if (!next.has(rel)) {
      const mtime = await mtimeOf(path.join(root, rel));
      events.push({
        uri: toUri(path.join(root, rel)),
        type: mtime === null ? DELETED : CHANGED,
      });
    }
  }
  notify(sessionId, events);
}

/** Look again shortly; bursts of signals collapse into one `git status`. */
export function scheduleWatchedFilesRefresh(sessionId: string): void {
  const pending = timers.get(sessionId);
  if (pending) {
    clearTimeout(pending);
  }
  timers.set(
    sessionId,
    setTimeout(() => {
      timers.delete(sessionId);
      refresh(sessionId).catch(() => undefined);
    }, WATCHED_FILES_DEBOUNCE_MS),
  );
}

function forget(sessionId?: string): void {
  for (const [id, timer] of timers) {
    if (!sessionId || id === sessionId) {
      clearTimeout(timer);
      timers.delete(id);
    }
  }
  for (const id of [...snapshots.keys()]) {
    if (!sessionId || id === sessionId) {
      snapshots.delete(id);
    }
  }
}

let detach: (() => void)[] = [];

/** Follow the session signals and its deletion. Idempotent. */
export function initLanguageServers(): void {
  for (const stop of detach) {
    stop();
  }
  detach = [
    addHostEventSink((channel, args) => {
      if (channel === "session:deleted" && typeof args[0] === "string") {
        stopLanguageServers(args[0]);
        forget(args[0]);

        return;
      }
      // A server just came up: take the baseline the next signal diffs against.
      const status = /^lsp:status:(.+)$/.exec(channel);
      if (status) {
        if (!snapshots.has(status[1]) && readyHandles(status[1]).length > 0) {
          scheduleWatchedFilesRefresh(status[1]);
        }

        return;
      }
      const diff = /^session:diff-changed:(.+)$/.exec(channel);
      const sessionId =
        diff?.[1] ??
        (channel === "git_status_changed"
          ? (args[0] as { sessionId?: string } | undefined)?.sessionId
          : undefined);
      if (sessionId && readyHandles(sessionId).length > 0) {
        scheduleWatchedFilesRefresh(sessionId);
      }
    }),
    onCodeFileWritten((sessionId, absolute) => {
      clientPath(sessionId, absolute)
        .then((rel) => {
          if (rel !== null) {
            notify(sessionId, [{ uri: toUri(absolute), type: CHANGED }]);
          }
        })
        .catch(() => undefined);
    }),
  ];
}

export function stopAllLanguageServers(): void {
  for (const stop of detach) {
    stop();
  }
  detach = [];
  forget();
  stopLanguageServers();
}
