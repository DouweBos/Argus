/**
 * Finding the projects Argus knows about: registered repo roots, plus the
 * `related_projects` each of their configs names.
 *
 * Read-only, and deliberately apart from `projects.ts` — registering a project
 * needs the session manager, and the manager needs this list to vet a repo
 * root. Together in one module that was a cycle.
 */

import type { ArgusConfig } from "../session/models";
import fs from "node:fs";
import path from "node:path";
import { appState } from "../../state";
import { loadArgusConfig } from "../session/argusConfig";

/** Check if a directory is a git repository. */
export function isGitRepo(dirPath: string): boolean {
  try {
    return fs.existsSync(path.join(dirPath, ".git"));
  } catch {
    return false;
  }
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
    let config: ArgusConfig;
    try {
      config = loadArgusConfig(repoRoot);
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
