/**
 * Per-project files that used to sit beside the worktrees — chat history and
 * command metrics. Only worktrees belong under a worktree root: these cover
 * the whole project, root session included, so they live on the boot disk
 * where an unplugged drive can't take them along.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "../../logger";
import { dropVolumeMetadata, projectDataDir } from "./metadata";
import { isOnMissingVolume } from "./volumeAvailability";
import { worktreeRootsForRepo } from "./worktreeLocation";

export const CHAT_HISTORY_DIR = ".argus-chat-history";
export const COMMAND_METRICS_FILE = ".argus-command-metrics.json";

interface HistoryIndex {
  version: number;
  entries: { endedAt: number; id: string }[];
}

interface MetricsFile {
  version: number;
  counts: Record<string, number>;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Keeps both copies — the target's entry wins where ids collide. */
function mergeHistory(from: string, to: string): void {
  const target = readJson<HistoryIndex>(path.join(to, "index.json"));
  const stray = readJson<HistoryIndex>(path.join(from, "index.json"));
  const entries = target?.entries ?? [];
  const known = new Set(entries.map((e) => e.id));
  for (const entry of stray?.entries ?? []) {
    if (known.has(entry.id)) {
      continue;
    }
    fs.copyFileSync(
      path.join(from, `${entry.id}.json`),
      path.join(to, `${entry.id}.json`),
    );
    entries.push(entry);
  }
  entries.sort((a, b) => b.endedAt - a.endedAt);
  const index: HistoryIndex = { version: target?.version ?? 1, entries };
  fs.writeFileSync(
    path.join(to, "index.json"),
    JSON.stringify(index, null, 2),
    "utf8",
  );
}

function mergeMetrics(from: string, to: string): void {
  const target = readJson<MetricsFile>(to);
  const counts = { ...target?.counts };
  for (const [name, n] of Object.entries(
    readJson<MetricsFile>(from)?.counts ?? {},
  )) {
    counts[name] = (counts[name] ?? 0) + n;
  }
  const file: MetricsFile = { version: target?.version ?? 1, counts };
  fs.writeFileSync(to, JSON.stringify(file, null, 2), "utf8");
}

const SIDECARS: Record<string, (from: string, to: string) => void> = {
  [CHAT_HISTORY_DIR]: mergeHistory,
  [COMMAND_METRICS_FILE]: mergeMetrics,
};

const evacuated = new Set<string>();

/**
 * Pull every sidecar off every worktree root this repo has used. Cheap after
 * the first complete pass; a root on an unplugged drive is retried later.
 */
export function evacuateWorktreeRoots(repoRoot: string): void {
  if (evacuated.has(repoRoot)) {
    return;
  }

  let complete = true;
  for (const root of worktreeRootsForRepo(repoRoot)) {
    if (isOnMissingVolume(root)) {
      complete = false;
      continue;
    }
    for (const [name, merge] of Object.entries(SIDECARS)) {
      const stray = path.join(root, name);
      if (!fs.existsSync(stray)) {
        continue;
      }
      const target = path.join(projectDataDir(repoRoot), name);
      try {
        if (fs.existsSync(target)) {
          merge(stray, target);
        } else {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.cpSync(stray, target, { recursive: true });
        }
        fs.rmSync(stray, { recursive: true, force: true });
      } catch (e) {
        complete = false;
        warn(`sidecars: could not move ${stray}: ${String(e)}`);
      }
    }
  }
  dropVolumeMetadata(repoRoot);
  if (complete) {
    evacuated.add(repoRoot);
  }
}

export function sidecarPath(repoRoot: string, name: string): string {
  evacuateWorktreeRoots(repoRoot);

  return path.join(projectDataDir(repoRoot), name);
}
