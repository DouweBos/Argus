/**
 * Watches the files a code editor has open — and nothing else. One `fs.watch`
 * per parent directory, shared by every file in it, never recursive: a
 * recursive watch hits EMFILE on large monorepos (why `session/watcher.ts`
 * polls). A change becomes `code:file-changed:<sessionId>` once its bytes
 * actually differ from what was last reported.
 */

import type { CodeFileChanged } from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { addHostEventSink, emitHostEvent } from "@argus/host/bus";
import { resolveContainedPath } from "../file/operations";
import {
  currentConnectionId,
  onConnectionClose,
} from "../remote/connectionScope";
import { currentVersion, onCodeFileWritten } from "./files";
import { clientPath } from "./paths";

export const FILE_CHANGE_DEBOUNCE_MS = 100;

/** A request over local IPC has no connection; it holds until unwatched. */
const LOCAL_HOLDER = "local";

/** Starts watching `dir`; `onChange` gets the entry name when the OS knows it. */
export type WatchDir = (
  dir: string,
  onChange: (name: string | null) => void,
) => () => void;

const fsWatchDir: WatchDir = (dir, onChange) => {
  const watcher = fs.watch(dir, { persistent: false }, (_event, name) => {
    onChange(name ? name.toString() : null);
  });
  watcher.on("error", () => undefined);

  return () => watcher.close();
};

let watchDir: WatchDir = fsWatchDir;

/** Swap the fs layer (tests). */
export function setWatchDirForTest(fn: WatchDir | null): void {
  watchDir = fn ?? fsWatchDir;
}

interface WatchedFile {
  sessionId: string;
  absolute: string;
  relativePath: string;
  hash: string | null;
  holders: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

interface DirWatch {
  stop: () => void;
  files: Set<WatchedFile>;
}

const files = new Map<string, WatchedFile>();
const dirs = new Map<string, DirWatch>();
const hookedConnections = new Set<string>();

const fileKey = (sessionId: string, absolute: string) =>
  `${sessionId}\0${absolute}`;

function holder(): string {
  return currentConnectionId() ?? LOCAL_HOLDER;
}

function check(file: WatchedFile): void {
  file.timer = null;
  const checked = currentVersion(file.absolute).then((version) => {
    if (files.get(fileKey(file.sessionId, file.absolute)) !== file) {
      return;
    }
    if (version.hash === file.hash) {
      return;
    }
    file.hash = version.hash;
    const payload: CodeFileChanged = {
      relativePath: file.relativePath,
      hash: version.hash,
      mtimeMs: version.mtimeMs,
    };
    emitHostEvent(`code:file-changed:${file.sessionId}`, payload);
  });
  checked.catch(() => undefined);
}

function schedule(file: WatchedFile): void {
  if (file.timer) {
    clearTimeout(file.timer);
  }
  file.timer = setTimeout(() => check(file), FILE_CHANGE_DEBOUNCE_MS);
}

function attach(file: WatchedFile): void {
  const dir = path.dirname(file.absolute);
  let watch = dirs.get(dir);
  if (!watch) {
    const watched = new Set<WatchedFile>();
    let stop: () => void;
    try {
      stop = watchDir(dir, (name) => {
        for (const f of watched) {
          if (name === null || name === path.basename(f.absolute)) {
            schedule(f);
          }
        }
      });
    } catch {
      // The directory isn't there (a new file in a new folder): nothing to see.
      return;
    }
    watch = { stop, files: watched };
    dirs.set(dir, watch);
  }
  watch.files.add(file);
}

function detach(file: WatchedFile): void {
  if (file.timer) {
    clearTimeout(file.timer);
    file.timer = null;
  }
  files.delete(fileKey(file.sessionId, file.absolute));
  const dir = path.dirname(file.absolute);
  const watch = dirs.get(dir);
  if (!watch) {
    return;
  }
  watch.files.delete(file);
  if (watch.files.size === 0) {
    dirs.delete(dir);
    watch.stop();
  }
}

function release(file: WatchedFile, who: string): void {
  file.holders.delete(who);
  if (file.holders.size === 0) {
    detach(file);
  }
}

function hookConnection(who: string): void {
  if (who === LOCAL_HOLDER || hookedConnections.has(who)) {
    return;
  }
  hookedConnections.add(who);
  onConnectionClose(() => {
    hookedConnections.delete(who);
    for (const file of [...files.values()]) {
      if (file.holders.has(who)) {
        release(file, who);
      }
    }
  });
}

async function resolveAll(
  id: string,
  paths: string[],
): Promise<{ absolute: string; relativePath: string }[]> {
  return Promise.all(
    paths.map(async (p) => {
      const absolute = await resolveContainedPath(id, p, { mustExist: false });

      return { absolute, relativePath: (await clientPath(id, absolute)) ?? p };
    }),
  );
}

export async function watchCodeFiles(
  id: string,
  paths: string[],
): Promise<void> {
  const who = holder();
  for (const { absolute, relativePath } of await resolveAll(id, paths)) {
    const key = fileKey(id, absolute);
    let file = files.get(key);
    if (!file) {
      file = {
        sessionId: id,
        absolute,
        relativePath,
        hash: null,
        holders: new Set(),
        timer: null,
      };
      files.set(key, file);
      attach(file);
      const created = file;
      file.hash = (await currentVersion(absolute)).hash;
      // Unwatched while hashing.
      if (files.get(key) !== created) {
        continue;
      }
    }
    file.holders.add(who);
  }
  hookConnection(who);
}

export async function unwatchCodeFiles(
  id: string,
  paths: string[],
): Promise<void> {
  const who = holder();
  for (const { absolute } of await resolveAll(id, paths)) {
    const file = files.get(fileKey(id, absolute));
    if (file) {
      release(file, who);
    }
  }
}

/** Drop every watch, or only a session's. */
export function stopCodeWatches(sessionId?: string): void {
  for (const file of [...files.values()]) {
    if (!sessionId || file.sessionId === sessionId) {
      detach(file);
    }
  }
}

/** Watched files per session, with their holder counts (tests). */
export function watchedCodeFiles(): { path: string; holders: number }[] {
  return [...files.values()].map((f) => ({
    path: f.relativePath,
    holders: f.holders.size,
  }));
}

/** Directories with a live watch (tests). */
export function watchedCodeDirs(): string[] {
  return [...dirs.keys()];
}

let detachSinks: (() => void)[] = [];

/** Follow session deletion and the editor's own saves. Idempotent. */
export function initCodeWatches(): void {
  for (const stop of detachSinks) {
    stop();
  }
  detachSinks = [
    addHostEventSink((channel, args) => {
      if (channel === "session:deleted" && typeof args[0] === "string") {
        stopCodeWatches(args[0]);
      }
    }),
    // The saving client already has the new hash; don't echo it back.
    onCodeFileWritten((id, absolute, hash) => {
      const file = files.get(fileKey(id, absolute));
      if (file) {
        file.hash = hash;
      }
    }),
  ];
}
