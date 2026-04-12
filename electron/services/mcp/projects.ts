/**
 * Cross-project discovery and registration helpers.
 *
 * Extracted from the MCP server so the logic is independently testable.
 */

import type { StagehandConfig } from "../workspace/models";
import fs from "node:fs";
import path from "node:path";
import { appState } from "../../state";
import { addRepoRoot, createHeadWorkspace } from "../workspace/manager";
import { loadStagehandConfig } from "../workspace/setup";

/** Check if a directory is a git repository. */
export function isGitRepo(dirPath: string): boolean {
  try {
    return fs.existsSync(path.join(dirPath, ".git"));
  } catch {
    return false;
  }
}

/**
 * Ensure a repo root is registered in appState. If not, register it and create
 * its head workspace so the UI shows it.
 */
export function ensureRepoRegistered(repoRoot: string): void {
  if (appState.repoRoots.has(repoRoot)) {
    return;
  }
  if (!isGitRepo(repoRoot)) {
    throw new Error(`Not a git repository: ${repoRoot}`);
  }
  addRepoRoot(repoRoot);
  createHeadWorkspace(repoRoot);
}

/** Shape returned by `collectAllProjects`. */
export interface ProjectEntry {
  path: string;
  description: string;
  registered: boolean;
  source: string;
}

/**
 * Collect all known projects: registered repo roots + related projects from
 * all configs. Returns deduplicated entries with absolute paths.
 */
export function collectAllProjects(): ProjectEntry[] {
  const seen = new Map<string, ProjectEntry>();

  // All registered repo roots.
  for (const repoRoot of appState.repoRoots) {
    const dirName = path.basename(repoRoot);
    seen.set(repoRoot, {
      path: repoRoot,
      description: `Registered project: ${dirName}`,
      registered: true,
      source: repoRoot,
    });
  }

  // Scan related_projects from each registered repo's config.
  for (const repoRoot of appState.repoRoots) {
    let config: StagehandConfig;
    try {
      config = loadStagehandConfig(repoRoot);
    } catch {
      continue;
    }

    for (const rel of config.related_projects ?? []) {
      const absPath = path.resolve(repoRoot, rel.path);
      if (seen.has(absPath)) {
        // Update description if the existing entry has a generic one.
        const existing = seen.get(absPath)!;
        if (
          rel.description &&
          existing.description.startsWith("Registered project:")
        ) {
          existing.description = rel.description;
        }
        continue;
      }
      seen.set(absPath, {
        path: absPath,
        description: rel.description,
        registered: appState.repoRoots.has(absPath),
        source: repoRoot,
      });
    }
  }

  return [...seen.values()];
}
