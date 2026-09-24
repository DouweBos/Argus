/**
 * The repo roots this host has open, persisted to `~/.argus/repo-roots.json`.
 *
 * `appState.repoRoots` used to live only in memory, filled by whichever client
 * called `add_repo_root`. That works for a desktop — its renderer replays its
 * own saved list at boot — but a headless server has no renderer, so it came
 * back from every restart with an empty sidebar for every client attached to
 * it. Persisting here makes the host the source of truth, which is what
 * `state_hydrate` already assumes when it prefills a newly attached client.
 *
 * Leaf-level on purpose: `manager.ts` imports this, never the other way round.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";

const SCHEMA_VERSION = 1;

interface RepoRootsFile {
  roots: string[];
  version: number;
}

function filePath(): string {
  return path.join(argusHomeDir(), "repo-roots.json");
}

/** Roots saved by a previous run. Empty on a first launch or a bad file. */
export function loadPersistedRepoRoots(): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath(), "utf8");
  } catch {
    return [];
  }

  let parsed: RepoRootsFile;
  try {
    parsed = JSON.parse(raw) as RepoRootsFile;
  } catch (e) {
    warn("Failed to parse repo-roots.json:", e);

    return [];
  }

  if (parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.roots)) {
    return [];
  }

  return parsed.roots.filter((r) => typeof r === "string" && r.length > 0);
}

/** Overwrite the saved list. Failures are logged, never thrown at the caller. */
export function persistRepoRoots(roots: Iterable<string>): void {
  const file: RepoRootsFile = {
    version: SCHEMA_VERSION,
    roots: [...new Set(roots)],
  };

  try {
    const target = filePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
    fs.renameSync(tmp, target);
  } catch (e) {
    warn("Failed to write repo-roots.json:", e);
  }
}
