/**
 * Per-developer, per-project settings stored at `~/.argus/user-project-settings.json`.
 *
 * Unlike `.argus.json` (which is checked in and shared across the team), this
 * file holds personal preferences keyed by repo root path. It is never written
 * into the repository, so each developer keeps their own values.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { warn } from "../../../app/lib/logger";

const SCHEMA_VERSION = 1;

export interface UserProjectSettings {
  /**
   * Required prefix applied to newly created branches (e.g. "douwe/" or
   * "team/feature-"). Empty string or undefined disables the prefix.
   */
  branch_prefix?: string;
  /**
   * Branch full names (`refs/heads/<name>`-stripped, i.e. just `name`) the
   * user has hidden from the main sidebar Branches list. They still exist in
   * git; this is purely a UI filter that surfaces them under "Archived
   * Branches" instead. Persisted per-project so each developer keeps their
   * own archive state.
   */
  archived_branches?: string[];
  /**
   * Branch names the user has pinned for quick access. Pinned branches appear
   * in a dedicated "Pinned" section at the top of the sidebar and are also
   * shown inline in the main Branches list. Persisted per-project.
   */
  pinned_branches?: string[];
  /**
   * When true, git-lfs warning banners are suppressed for this project
   * regardless of auto-detection. Personal preference; never written into
   * the repo.
   */
  suppress_lfs_warning?: boolean;
}

interface UserProjectSettingsFile {
  version: number;
  projects: Record<string, UserProjectSettings>;
}

function filePath(): string {
  return path.join(os.homedir(), ".argus", "user-project-settings.json");
}

function readAll(): UserProjectSettingsFile {
  const empty: UserProjectSettingsFile = {
    version: SCHEMA_VERSION,
    projects: {},
  };

  let raw: string;
  try {
    raw = fs.readFileSync(filePath(), "utf8");
  } catch {
    return empty;
  }

  let parsed: UserProjectSettingsFile;
  try {
    parsed = JSON.parse(raw) as UserProjectSettingsFile;
  } catch (e) {
    warn("Failed to parse user-project-settings.json:", e);

    return empty;
  }

  if (
    parsed.version !== SCHEMA_VERSION ||
    !parsed.projects ||
    typeof parsed.projects !== "object"
  ) {
    return empty;
  }

  return parsed;
}

function writeAll(file: UserProjectSettingsFile): void {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

/** Load the personal settings for a single project. Always returns an object. */
export function loadUserProjectSettings(repoRoot: string): UserProjectSettings {
  const file = readAll();

  return file.projects[repoRoot] ?? {};
}

/**
 * Write the personal settings for a single project, merging with any existing
 * values for that project. Omitting a key leaves its current value untouched;
 * to clear a field, pass it as an empty string or `undefined`.
 */
export function saveUserProjectSettings(
  repoRoot: string,
  settings: UserProjectSettings,
): UserProjectSettings {
  const file = readAll();
  const current = file.projects[repoRoot] ?? {};
  const next: UserProjectSettings = { ...current, ...settings };

  if (next.branch_prefix === "" || next.branch_prefix === undefined) {
    delete next.branch_prefix;
  }
  if (next.archived_branches !== undefined) {
    if (!Array.isArray(next.archived_branches)) {
      delete next.archived_branches;
    } else {
      // De-dupe + drop empty strings; clear the field if nothing's left.
      const cleaned = Array.from(
        new Set(
          next.archived_branches.filter(
            (n) => typeof n === "string" && n.length > 0,
          ),
        ),
      );
      if (cleaned.length === 0) {
        delete next.archived_branches;
      } else {
        next.archived_branches = cleaned;
      }
    }
  }

  if (next.pinned_branches !== undefined) {
    if (!Array.isArray(next.pinned_branches)) {
      delete next.pinned_branches;
    } else {
      const cleaned = Array.from(
        new Set(
          next.pinned_branches.filter(
            (n) => typeof n === "string" && n.length > 0,
          ),
        ),
      );
      if (cleaned.length === 0) {
        delete next.pinned_branches;
      } else {
        next.pinned_branches = cleaned;
      }
    }
  }

  file.projects[repoRoot] = next;
  writeAll(file);

  return next;
}

/** Add a branch to the archived list. Idempotent. */
export function archiveBranch(repoRoot: string, branch: string): string[] {
  const current = loadUserProjectSettings(repoRoot);
  const list = current.archived_branches ?? [];
  if (list.includes(branch)) {
    return list;
  }
  const next = saveUserProjectSettings(repoRoot, {
    archived_branches: [...list, branch],
  });

  return next.archived_branches ?? [];
}

/** Remove a branch from the archived list. Idempotent. */
export function unarchiveBranch(repoRoot: string, branch: string): string[] {
  const current = loadUserProjectSettings(repoRoot);
  const list = current.archived_branches ?? [];
  if (!list.includes(branch)) {
    return list;
  }
  const next = saveUserProjectSettings(repoRoot, {
    archived_branches: list.filter((n) => n !== branch),
  });

  return next.archived_branches ?? [];
}

/** List archived branch names for a project. Always returns an array. */
export function listArchivedBranches(repoRoot: string): string[] {
  return loadUserProjectSettings(repoRoot).archived_branches ?? [];
}

/** Add a branch to the pinned list. Idempotent. */
export function pinBranch(repoRoot: string, branch: string): string[] {
  const current = loadUserProjectSettings(repoRoot);
  const list = current.pinned_branches ?? [];
  if (list.includes(branch)) {
    return list;
  }
  const next = saveUserProjectSettings(repoRoot, {
    pinned_branches: [...list, branch],
  });

  return next.pinned_branches ?? [];
}

/** Remove a branch from the pinned list. Idempotent. */
export function unpinBranch(repoRoot: string, branch: string): string[] {
  const current = loadUserProjectSettings(repoRoot);
  const list = current.pinned_branches ?? [];
  if (!list.includes(branch)) {
    return list;
  }
  const next = saveUserProjectSettings(repoRoot, {
    pinned_branches: list.filter((n) => n !== branch),
  });

  return next.pinned_branches ?? [];
}

/** List pinned branch names for a project. Always returns an array. */
export function listPinnedBranches(repoRoot: string): string[] {
  return loadUserProjectSettings(repoRoot).pinned_branches ?? [];
}

/**
 * Apply the configured prefix to a user-supplied branch name.
 *
 * If the branch already begins with the prefix (case-sensitive), it is
 * returned unchanged — users can still type the full name if they want.
 */
export function applyBranchPrefix(branch: string, prefix: string): string {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return branch;
  }
  if (branch.startsWith(trimmed)) {
    return branch;
  }

  return `${trimmed}${branch}`;
}
