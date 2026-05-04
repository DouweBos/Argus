/**
 * Persisted session metadata (display names, descriptions) keyed by path.
 *
 * Stored at `{worktreesRoot}/.argus-sessions.json`. Survives app restarts.
 * Migration removes entries for worktrees that no longer exist on disk.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "../../../app/lib/logger";

const METADATA_FILENAME = ".argus-sessions.json";
const LEGACY_METADATA_FILENAME = ".argus-workspaces.json";
const SCHEMA_VERSION = 1;

/** Persisted metadata for a single session. */
export interface SessionMeta {
  id: string;
  display_name?: string | null;
  description: string;
  base_branch?: string | null;
  organization_task_id?: string | null;
  /**
   * LLM runner bound to this session at creation time. Legacy entries
   * persisted before this field existed default to `"claude-code"` on read
   * via `sessionRunnerId`.
   */
  runner_id?: string | null;
  /** Default model for agents spawned in this session. `null` defers to
   * the project/app/runner defaults. */
  model?: string | null;
}

interface MetadataFile {
  version: number;
  sessions: Record<string, SessionMeta>;
}

/**
 * Legacy on-disk shape written by older Argus versions. The top-level field
 * was named `workspaces` before the session rename. We still accept it on read
 * so upgrades don't lose metadata.
 */
interface LegacyMetadataFile {
  version: number;
  workspaces: Record<string, SessionMeta>;
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
  meta: Map<string, SessionMeta>,
  worktreePath: string,
): SessionMeta | undefined {
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
 * Load persisted session metadata. Returns an empty Map if file is missing or invalid.
 */
export function loadMetadata(
  worktreesRootDir: string,
): Map<string, SessionMeta> {
  // Prefer the current file. Fall back to the legacy pre-rename file so
  // upgrading users don't lose their session metadata. The legacy file is
  // left in place for rollback safety.
  const primaryPath = metadataPath(worktreesRootDir);
  const legacyPath = path.join(worktreesRootDir, LEGACY_METADATA_FILENAME);
  let raw: string;
  try {
    raw = fs.readFileSync(primaryPath, "utf8");
  } catch {
    try {
      raw = fs.readFileSync(legacyPath, "utf8");
    } catch {
      return new Map();
    }
  }

  let file: LegacyMetadataFile | MetadataFile;
  try {
    file = JSON.parse(raw) as LegacyMetadataFile | MetadataFile;
  } catch {
    return new Map();
  }

  if (file.version !== SCHEMA_VERSION) {
    return new Map();
  }

  // Accept either the new `sessions` field or the legacy `workspaces` field.
  let entries: Record<string, SessionMeta> = {};
  if ("sessions" in file && file.sessions) {
    entries = file.sessions;
  } else if ("workspaces" in file && file.workspaces) {
    entries = file.workspaces;
  }

  const result = new Map<string, SessionMeta>();
  for (const [key, value] of Object.entries(entries)) {
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
  sessions: Map<string, SessionMeta>,
): void {
  const file: MetadataFile = {
    version: SCHEMA_VERSION,
    sessions: Object.fromEntries(sessions.entries()),
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
  meta: Map<string, SessionMeta>,
): [Map<string, SessionMeta>, boolean] {
  const migrated = new Map<string, SessionMeta>();
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
