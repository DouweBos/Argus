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

  file.projects[repoRoot] = next;
  writeAll(file);

  return next;
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
