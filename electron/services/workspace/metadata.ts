/**
 * Persisted workspace metadata (display names, descriptions) keyed by path.
 *
 * Stored at `{worktreesRoot}/.stagehand-workspaces.json`. Survives app restarts.
 * Migration removes entries for worktrees that no longer exist on disk.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "../../../app/lib/logger";

const METADATA_FILENAME = ".stagehand-workspaces.json";
const SCHEMA_VERSION = 1;

/** Persisted metadata for a single workspace. */
export interface WorkspaceMeta {
  id: string;
  display_name?: string | null;
  description: string;
  base_branch?: string | null;
}

interface MetadataFile {
  version: number;
  workspaces: Record<string, WorkspaceMeta>;
}

function metadataPath(worktreesRootDir: string): string {
  return path.join(worktreesRootDir, METADATA_FILENAME);
}

/** Normalize path for consistent lookup (handles trailing slashes, separators). */
function normalizePathKey(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Look up metadata by worktree path (uses normalized key for consistent matching).
 */
export function getMeta(
  meta: Map<string, WorkspaceMeta>,
  worktreePath: string,
): WorkspaceMeta | undefined {
  return meta.get(normalizePathKey(worktreePath));
}

/**
 * Returns true if the path is a valid git worktree (directory exists and has a .git file).
 */
export function isValidWorktree(worktreePath: string): boolean {
  return (
    fs.existsSync(worktreePath) &&
    fs.existsSync(path.join(worktreePath, ".git"))
  );
}

/**
 * Load persisted workspace metadata. Returns an empty Map if file is missing or invalid.
 */
export function loadMetadata(
  worktreesRootDir: string,
): Map<string, WorkspaceMeta> {
  const filePath = metadataPath(worktreesRootDir);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return new Map();
  }

  let file: MetadataFile;
  try {
    file = JSON.parse(raw) as MetadataFile;
  } catch {
    return new Map();
  }

  if (file.version !== SCHEMA_VERSION) {
    return new Map();
  }

  const result = new Map<string, WorkspaceMeta>();
  for (const [key, value] of Object.entries(file.workspaces)) {
    result.set(normalizePathKey(key), value);
  }

  return result;
}

/**
 * Save metadata to disk. Caller should pass only entries for paths that still
 * exist (filter out orphaned worktrees before calling).
 */
export function saveMetadata(
  worktreesRootDir: string,
  workspaces: Map<string, WorkspaceMeta>,
): void {
  const file: MetadataFile = {
    version: SCHEMA_VERSION,
    workspaces: Object.fromEntries(workspaces.entries()),
  };

  const json = JSON.stringify(file, null, 2);
  fs.mkdirSync(worktreesRootDir, { recursive: true });
  fs.writeFileSync(metadataPath(worktreesRootDir), json, "utf8");
}

/**
 * Remove metadata entries for worktrees that no longer exist on disk or whose
 * `.git` file is missing. Returns the migrated map and whether any entries
 * were removed.
 */
export function migrateOrphaned(
  worktreesRootDir: string,
  meta: Map<string, WorkspaceMeta>,
): [Map<string, WorkspaceMeta>, boolean] {
  const migrated = new Map<string, WorkspaceMeta>();
  let removed = false;

  for (const [pathKey, entry] of meta) {
    if (isValidWorktree(pathKey)) {
      migrated.set(pathKey, entry);
    } else {
      removed = true;
    }
  }

  if (removed) {
    try {
      saveMetadata(worktreesRootDir, migrated);
    } catch (e) {
      warn("Failed to persist migrated metadata:", e);
    }
  }

  return [migrated, removed];
}
