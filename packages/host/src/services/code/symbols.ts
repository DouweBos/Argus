/**
 * A per-session index of definitions for Open Quickly, built lazily by one
 * ripgrep run over the worktree with `symbolRules`' heuristics — no language
 * server needed. Kept in memory, patched file by file as git reports changes,
 * rebuilt when HEAD moves, and dropped with the session or after ten idle
 * minutes.
 */

import type {
  CodeSymbol,
  CodeSymbolKind,
  CodeSymbolSearchResult,
} from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { addHostEventSink } from "@argus/host/bus";
import { createLogger } from "@argus/host/logger";
import { git } from "../session/git";
import { onCodeFileWritten } from "./files";
import { foldQuery, fuzzyScore } from "./fuzzy";
import { canonicalSessionRoot, clientPath } from "./paths";
import { languageForPath } from "./symbolRules";
import { scan, type SessionIndex } from "./symbolScan";

const log = createLogger("code-symbols");
const indexes = new Map<string, SessionIndex>();

export const DEFAULT_SYMBOL_LIMIT = 100;
export const MAX_SYMBOL_LIMIT = 500;
/** Mutable so tests needn't wait. */
export const SYMBOL_TIMING = {
  idleEvictMs: 10 * 60_000,
  /** How long a query waits for a build before answering with what's there. */
  buildWaitMs: 1500,
  refreshDebounceMs: 500,
};
const REFRESH_CHUNK = 400;

async function headOf(root: string): Promise<string | null> {
  return (
    (await git(root, ["rev-parse", "HEAD"]).catch(() => null))?.trim() || null
  );
}

function build(index: SessionIndex): Promise<void> {
  if (index.building) {
    return index.building;
  }
  index.stale = false;
  index.files = new Map();
  index.names = new Map();
  const started = Date.now();
  index.building = (async () => {
    index.head = await headOf(index.root);
    await scan(index, []);
    const stats = symbolIndexStats(index.sessionId);
    log.info(
      `indexed ${stats?.symbols} symbols in ${stats?.files} files in ${Date.now() - started}ms`,
    );
  })().finally(() => {
    index.building = null;
  });

  return index.building;
}

function touch(index: SessionIndex): void {
  index.lastUsed = Date.now();
  if (index.evictTimer) {
    clearTimeout(index.evictTimer);
  }
  index.evictTimer = setTimeout(
    () => dropSymbolIndex(index.sessionId),
    SYMBOL_TIMING.idleEvictMs,
  );
  index.evictTimer.unref?.();
}

function indexFor(sessionId: string): SessionIndex {
  let index = indexes.get(sessionId);
  if (!index) {
    index = {
      sessionId,
      root: canonicalSessionRoot(sessionId),
      files: new Map(),
      building: null,
      children: new Set(),
      head: null,
      stale: true,
      dirty: new Map(),
      lastUsed: Date.now(),
      evictTimer: null,
      refreshTimer: null,
      names: new Map(),
    };
    indexes.set(sessionId, index);
  }

  return index;
}

/** Types first when the names score the same. */
const KIND_WEIGHT = new Map<CodeSymbolKind, number>(
  Object.entries({
    class: 3,
    struct: 3,
    enum: 3,
    interface: 3,
    protocol: 3,
    type_alias: 2,
    function: 1,
    method: 1,
    extension: -1,
    variable: -1,
  }) as [CodeSymbolKind, number][],
);

export function rankSymbols(
  files: Iterable<CodeSymbol[]>,
  query: string,
  limit: number,
  kinds?: Set<CodeSymbolKind>,
): CodeSymbol[] {
  const needle = foldQuery(query);
  if (needle.length === 0) {
    return [];
  }
  const scored: { symbol: CodeSymbol; score: number }[] = [];
  let floor = -Infinity;
  for (const symbols of files) {
    for (const symbol of symbols) {
      if (kinds && !kinds.has(symbol.kind)) {
        continue;
      }
      const base = fuzzyScore(needle, symbol.name);
      if (base === null) {
        continue;
      }
      const score = base * 8 + (KIND_WEIGHT.get(symbol.kind) ?? 0);
      if (score < floor) {
        continue;
      }
      scored.push({ symbol, score });
      // Keep the working set bounded on huge trees.
      if (scored.length >= limit * 8) {
        scored.sort((a, b) => b.score - a.score);
        scored.length = limit;
        floor = scored[limit - 1].score;
      }
    }
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.symbol.relativePath.localeCompare(b.symbol.relativePath) ||
      a.symbol.line - b.symbol.line,
  );

  return scored.slice(0, limit).map((s) => s.symbol);
}

export async function searchSymbols(
  sessionId: string,
  query: string,
  limit = DEFAULT_SYMBOL_LIMIT,
  kinds?: CodeSymbolKind[],
): Promise<CodeSymbolSearchResult> {
  const index = indexFor(sessionId);
  touch(index);
  if (index.stale && !index.building) {
    build(index).catch((err: unknown) =>
      log.error(`symbol index failed: ${String(err)}`),
    );
  }
  if (index.building) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      index.building,
      new Promise((resolve) => {
        timer = setTimeout(resolve, SYMBOL_TIMING.buildWaitMs);
      }),
    ]);
    clearTimeout(timer);
  }
  const symbols = rankSymbols(
    index.files.values(),
    query,
    Math.min(Math.max(1, limit), MAX_SYMBOL_LIMIT),
    kinds?.length ? new Set(kinds) : undefined,
  );
  // Idle counts from the last answer, not the start of a long build.
  if (indexes.get(sessionId) === index) {
    touch(index);
  }

  return { symbols, complete: !index.building && !index.stale };
}

function parseStatus(out: string): string[] {
  const paths: string[] = [];
  const entries = out.split("\0");
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].length < 4) {
      continue;
    }
    paths.push(entries[i].slice(3));
    if (entries[i][0] === "R" || entries[i][0] === "C") {
      i += 1;
    }
  }

  return paths;
}

async function mtimeOf(file: string): Promise<number | null> {
  return fs.promises.stat(file).then(
    (s) => s.mtimeMs,
    () => null,
  );
}

/** Re-reads the given files: deleted ones drop out, the rest are scanned again. */
async function refreshFiles(
  index: SessionIndex,
  relativePaths: string[],
): Promise<void> {
  const present: string[] = [];
  for (const rel of relativePaths) {
    if (!languageForPath(rel)) {
      continue;
    }
    if ((await mtimeOf(path.join(index.root, rel))) === null) {
      index.files.delete(rel);
    } else {
      // Scanned files with no definitions left get no `end` with matches: clear first.
      index.files.delete(rel);
      present.push(rel);
    }
  }
  for (let i = 0; i < present.length; i += REFRESH_CHUNK) {
    await scan(index, present.slice(i, i + REFRESH_CHUNK));
  }
}

/** Git says something changed: patch the files whose mtime moved, or rebuild on a new HEAD. */
export async function refreshSymbolIndex(sessionId: string): Promise<void> {
  const index = indexes.get(sessionId);
  if (!index || index.stale) {
    return;
  }
  if (index.building) {
    await index.building;
  }
  const head = await headOf(index.root);
  if (head !== index.head) {
    index.stale = true;
    index.dirty.clear();

    return;
  }
  const out = await git(index.root, [
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
    next.set(rel, await mtimeOf(path.join(index.root, rel)));
  }
  const changed = [...next]
    .filter(([rel, mtime]) => index.dirty.get(rel) !== mtime)
    .map(([rel]) => rel);
  // Out of the status now: reverted or deleted.
  changed.push(...[...index.dirty.keys()].filter((rel) => !next.has(rel)));
  index.dirty = next;
  if (indexes.get(sessionId) === index) {
    await refreshFiles(index, changed);
  }
}

function scheduleRefresh(sessionId: string): void {
  const index = indexes.get(sessionId);
  if (!index) {
    return;
  }
  if (index.refreshTimer) {
    clearTimeout(index.refreshTimer);
  }
  index.refreshTimer = setTimeout(() => {
    index.refreshTimer = null;
    refreshSymbolIndex(sessionId).catch(() => undefined);
  }, SYMBOL_TIMING.refreshDebounceMs);
}

export function dropSymbolIndex(sessionId?: string): void {
  for (const [id, index] of [...indexes]) {
    if (sessionId && id !== sessionId) {
      continue;
    }
    indexes.delete(id);
    for (const timer of [index.evictTimer, index.refreshTimer]) {
      if (timer) {
        clearTimeout(timer);
      }
    }
    for (const child of index.children) {
      child.kill();
    }
  }
}

/** Null when the session has no index. */
export function symbolIndexStats(
  sessionId: string,
): { files: number; symbols: number } | null {
  const index = indexes.get(sessionId);
  if (!index) {
    return null;
  }
  let count = 0;
  for (const symbols of index.files.values()) {
    count += symbols.length;
  }

  return { files: index.files.size, symbols: count };
}

let detach: (() => void)[] = [];

/** Follow git's change signals, the editor's saves, and session deletion. Idempotent. */
export function initSymbolIndex(): void {
  stopSymbolIndex();
  detach = [
    addHostEventSink((channel, args) => {
      if (channel === "session:deleted" && typeof args[0] === "string") {
        dropSymbolIndex(args[0]);

        return;
      }
      const diff = /^session:diff-changed:(.+)$/.exec(channel);
      const sessionId =
        diff?.[1] ??
        (channel === "git_status_changed"
          ? (args[0] as { sessionId?: string } | undefined)?.sessionId
          : undefined);
      if (sessionId) {
        scheduleRefresh(sessionId);
      }
    }),
    onCodeFileWritten((sessionId, absolute) => {
      const index = indexes.get(sessionId);
      if (!index || index.stale) {
        return;
      }
      clientPath(sessionId, absolute)
        .then((rel) =>
          rel && !path.isAbsolute(rel) ? refreshFiles(index, [rel]) : undefined,
        )
        .catch(() => undefined);
    }),
  ];
}

export function stopSymbolIndex(): void {
  for (const stop of detach) {
    stop();
  }
  detach = [];
  dropSymbolIndex();
}
