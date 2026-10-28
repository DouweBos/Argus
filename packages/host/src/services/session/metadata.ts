/**
 * Persisted session metadata (display names, descriptions) keyed by path.
 *
 * Stored at `<argusHome>/projects/<key>/sessions.json`, keyed by repo root.
 * It deliberately does *not* live with the worktrees: when those sit on an
 * external drive, this is the only record of what the sessions were called,
 * and it has to survive the drive being unplugged. It also carries the branch
 * and kind, so a session can be drawn with no access to its files at all.
 */

import type { DesignRef, LinkedIssue } from "@argus/remote-protocol";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { canonicalPath } from "../../lib/canonicalPath";
import { isOnMissingVolume } from "./volumeAvailability";
import { worktreeRootsForRepo } from "./worktreeLocation";

const METADATA_FILENAME = ".argus-sessions.json";
const LEGACY_METADATA_FILENAME = ".argus-workspaces.json";
const SCHEMA_VERSION = 2;
/** The on-volume schema this replaced. Read once, then migrated. */
const ON_VOLUME_SCHEMA_VERSION = 1;

/** Persisted metadata for a single session. */
export interface SessionMeta {
  id: string;
  display_name?: string | null;
  description: string;
  base_branch?: string | null;
  /**
   * LLM runner bound to this session at creation time. Legacy entries
   * persisted before this field existed default to `"claude-code"` on read
   * via `sessionRunnerId`.
   */
  runner_id?: string | null;
  /** Default model for agents spawned in this session. `null` defers to
   * the project/app/runner defaults. */
  model?: string | null;
  /** Claude account this session authenticates as. `null` follows the
   * app-wide active account. */
  claude_account_id?: string | null;
  linked_issue?: LinkedIssue | null;
  design_refs?: DesignRef[] | null;
  /**
   * Last known branch. Recorded so a session whose drive is disconnected can
   * still be listed — `git worktree list` is not readable for it.
   */
  branch?: string;
  /** Last known session kind, for the same reason. */
  kind?: "automation_host" | "project_root" | "scratch_pad" | "worktree";
  /** Epoch ms the worktree was last confirmed present on disk. */
  last_seen_at?: number;
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

/** Stable per-repo directory name; the basename alone collides. */
function projectKey(repoRoot: string): string {
  const digest = crypto.createHash("sha1").update(repoRoot).digest("hex");

  return `${path.basename(repoRoot) || "repo"}-${digest.slice(0, 8)}`;
}

/** Per-project state on the boot disk, reachable whatever drive holds the worktrees. */
export function projectDataDir(repoRoot: string): string {
  return path.join(argusHomeDir(), "projects", projectKey(repoRoot));
}

function indexPath(repoRoot: string): string {
  return path.join(projectDataDir(repoRoot), "sessions.json");
}

/** Normalize path for consistent lookup (handles trailing slashes, separators). */
export function normalizeMetaKey(p: string): string {
  return normalizePathKey(p);
}

/** Canonical too, so `/tmp/…` and git's `/private/tmp/…` are one entry. */
function normalizePathKey(p: string): string {
  const slashed = p.replace(/\\/g, "/");
  const real = path.isAbsolute(slashed) ? canonicalPath(slashed) : slashed;

  return real.replace(/\\/g, "/").replace(/\/+$/, "");
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

function parseEntries(raw: string, version: number): Map<string, SessionMeta> {
  let file: LegacyMetadataFile | MetadataFile;
  try {
    file = JSON.parse(raw) as LegacyMetadataFile | MetadataFile;
  } catch {
    return new Map();
  }
  if (file.version !== version) {
    return new Map();
  }

  // Accept either the current `sessions` field or the legacy `workspaces` one.
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
 * Read whatever an older Argus left beside the worktrees.
 *
 * Checked across every root this repo has used, because a location change can
 * leave the only copy under the previous one.
 */
function loadFromVolume(repoRoot: string): Map<string, SessionMeta> {
  for (const root of worktreeRootsForRepo(repoRoot)) {
    for (const name of [METADATA_FILENAME, LEGACY_METADATA_FILENAME]) {
      let raw: string;
      try {
        raw = fs.readFileSync(path.join(root, name), "utf8");
      } catch {
        continue;
      }
      const parsed = parseEntries(raw, ON_VOLUME_SCHEMA_VERSION);
      if (parsed.size > 0) {
        return parsed;
      }
    }
  }

  return new Map();
}

/**
 * Load persisted session metadata for a repo. Empty when there is none.
 *
 * Migrates the pre-v2 file that lived beside the worktrees;
 * `dropVolumeMetadata` removes the original afterwards.
 */
export function loadMetadata(repoRoot: string): Map<string, SessionMeta> {
  try {
    const raw = fs.readFileSync(indexPath(repoRoot), "utf8");
    const parsed = parseEntries(raw, SCHEMA_VERSION);
    if (parsed.size > 0) {
      return parsed;
    }
  } catch {
    // Not written yet — fall through to the migration.
  }

  const migrated = loadFromVolume(repoRoot);
  if (migrated.size > 0) {
    saveMetadata(repoRoot, migrated);
  }

  return migrated;
}

/**
 * Delete the pre-v2 files beside the worktrees once the internal copy exists.
 * Only worktrees belong under a worktree root.
 */
export function dropVolumeMetadata(repoRoot: string): void {
  if (!fs.existsSync(indexPath(repoRoot))) {
    return;
  }
  for (const root of worktreeRootsForRepo(repoRoot)) {
    for (const name of [METADATA_FILENAME, LEGACY_METADATA_FILENAME]) {
      fs.rmSync(path.join(root, name), { force: true });
    }
  }
}

/**
 * Save metadata for a repo. Written atomically, and always to the internal
 * disk, so an external drive going away can never take it with it.
 */
export function saveMetadata(
  repoRoot: string,
  sessions: Map<string, SessionMeta>,
): void {
  const file: MetadataFile = {
    version: SCHEMA_VERSION,
    sessions: Object.fromEntries(sessions.entries()),
  };

  const target = indexPath(repoRoot);
  const tmp = `${target}.tmp`;
  fs.mkdirSync(projectDataDir(repoRoot), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

/**
 * Remove metadata entries for worktrees that are genuinely gone. Returns the
 * migrated map and whether any entries were removed.
 *
 * Entries on an unmounted volume are kept: they are what the sidebar renders
 * while the drive is away, and dropping them would lose the session's name and
 * description for good.
 */
export function migrateOrphaned(
  repoRoot: string,
  meta: Map<string, SessionMeta>,
): [Map<string, SessionMeta>, boolean] {
  const migrated = new Map<string, SessionMeta>();
  let removed = false;

  for (const [pathKey, entry] of meta) {
    if (isValidWorktree(pathKey) || isOnMissingVolume(pathKey)) {
      migrated.set(pathKey, entry);
    } else {
      removed = true;
    }
  }

  if (removed) {
    try {
      saveMetadata(repoRoot, migrated);
    } catch (e) {
      warn("Failed to persist migrated metadata:", e);
    }
  }

  return [migrated, removed];
}
