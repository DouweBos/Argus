/**
 * File operations service — list, read, and write files inside a session.
 *
 * All functions resolve paths relative to the session root and reject any
 * path that escapes it.
 *
 * Errors are thrown as plain strings to match IPC error handling.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { appState } from "../../state";
import { git } from "../session/git";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single directory entry returned by {@link listDirectory}. */
export interface DirEntry {
  name: string;
  is_dir: boolean;
  size: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List the contents of a directory inside a session.
 *
 * Returns entries sorted directories-first, then alphabetical
 * (case-insensitive). The `.git` directory is filtered out at the root level.
 *
 * @throws string if the session is not found, the path escapes the root, or
 *   the directory cannot be read.
 */
/**
 * Read a text file from a session.
 *
 * Rejects binary files (null bytes in the first 8 KB) and files larger than
 * 5 MB.
 *
 * Accepts a session-relative or absolute path; either way the canonical
 * target must sit inside this session's worktree or a registered project.
 *
 * @throws string if the session is not found, the path escapes those roots,
 *   the file is binary, the file is too large, or the file cannot be read.
 */
export async function readFile(
  id: string,
  relativePath: string,
): Promise<string> {
  const target = await resolveContainedPath(id, relativePath, {
    mustExist: true,
  });

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(target);
  } catch (e) {
    throw `Failed to read file metadata: ${String(e)}`;
  }

  const MAX_SIZE = 5 * 1024 * 1024;
  if (stat.size > MAX_SIZE) {
    throw "File is too large (>5 MB)";
  }

  let content: Buffer;
  try {
    content = await fs.promises.readFile(target);
  } catch (e) {
    throw `Failed to read file: ${String(e)}`;
  }

  // Check for binary content: null bytes in the first 8 KB
  const checkLen = Math.min(content.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    if (content[i] === 0) {
      throw "File appears to be binary";
    }
  }

  // Validate UTF-8 by round-tripping through the string decoder
  const text = content.toString("utf8");
  if (Buffer.byteLength(text, "utf8") !== content.length) {
    throw "File is not valid UTF-8";
  }

  return text;
}

/**
 * Write a text file to a session.
 *
 * Creates parent directories if they do not already exist. Containment
 * matches {@link readFile}.
 *
 * @throws string if the session is not found, the path escapes the allowed
 *   roots, or the file cannot be written.
 */
/**
 * Stat a file or directory inside a session.
 *
 * Returns type (file/directory), size, and mtime.
 *
 * @throws string if the session is not found, the path escapes the root,
 *   or the file cannot be stat'd.
 */
export async function statFile(
  id: string,
  relativePath: string,
): Promise<{ is_dir: boolean; size: number; mtime: number }> {
  const root = sessionPath(id);
  const target = await resolveSafePath(root, relativePath);

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(target);
  } catch (e) {
    throw `Failed to stat file: ${String(e)}`;
  }

  return {
    is_dir: stat.isDirectory(),
    size: stat.size,
    mtime: stat.mtimeMs,
  };
}

export async function writeFile(
  id: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = await resolveContainedPath(id, relativePath, {
    mustExist: false,
  });

  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
  } catch (e) {
    throw `Failed to create parent directories: ${String(e)}`;
  }

  try {
    await fs.promises.writeFile(target, content, "utf8");
  } catch (e) {
    throw `Failed to write file: ${String(e)}`;
  }
}

// ---------------------------------------------------------------------------
// Absolute-path operations (used by the VS Code filesystem provider)
//
// These accept raw absolute paths and validate that they fall inside a
// known session before performing any I/O.
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical (symlink-followed) paths of every registered
 * session. Cached per call site — sessions are added/removed rarely and
 * the cost of `realpath` is dwarfed by the I/O these handlers do anyway.
 */
async function canonicalSessionRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const ws of appState.sessions.values()) {
    try {
      roots.push(await fs.promises.realpath(ws.path));
    } catch {
      // Session path is missing on disk; skip it.
    }
  }

  return roots;
}

/**
 * Assert that an absolute path resolves (after following symlinks) to a
 * location inside a registered session.
 *
 * String-prefix containment is not enough on its own: symlinks inside a
 * session (commonplace in pnpm `node_modules`, the setup pipeline's
 * `setup.symlink` step, and user-created links) would otherwise let any
 * caller of these IPC handlers escape the session and read/write arbitrary
 * paths on disk (e.g. `<ws>/node_modules/x` → `~/.ssh`). We canonicalize
 * both sides before comparing.
 *
 * For paths that don't yet exist (write/mkdir/rename targets), pass
 * `mustExist: false` — we then canonicalize the deepest existing ancestor
 * and append the unresolved tail.
 *
 * @throws string if the canonical path is not inside any session.
 */
async function assertInsideSession(
  absPath: string,
  options: { mustExist?: boolean } = {},
): Promise<void> {
  const mustExist = options.mustExist ?? true;
  const canonical = await canonicalize(absPath, mustExist);
  const roots = await canonicalSessionRoots();
  for (const root of roots) {
    if (canonical === root || canonical.startsWith(root + path.sep)) {
      return;
    }
  }
  throw `Path is not inside any session: ${absPath}`;
}

/**
 * Resolve symlinks for whatever portion of `absPath` exists on disk and
 * return the canonical absolute path. When the leaf does not exist we walk
 * up until we find an existing ancestor, canonicalize that, then re-append
 * the unresolved tail.
 */
async function canonicalize(
  absPath: string,
  mustExist: boolean,
): Promise<string> {
  const normalized = path.resolve(absPath);
  try {
    return await fs.promises.realpath(normalized);
  } catch (e) {
    if (mustExist) {
      throw `Failed to resolve path: ${String(e)}`;
    }
  }

  // Walk up to the deepest existing ancestor, then re-attach the tail.
  const segments: string[] = [];
  let cursor = normalized;
  while (true) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      // Reached filesystem root without finding an existing ancestor.
      throw `Failed to resolve path: ${absPath}`;
    }
    segments.unshift(path.basename(cursor));
    cursor = parent;
    try {
      const realParent = await fs.promises.realpath(cursor);

      return path.join(realParent, ...segments);
    } catch {
      // Keep walking up.
    }
  }
}

/** List directory contents at an absolute path. */
export async function listPath(absPath: string): Promise<DirEntry[]> {
  await assertInsideSession(absPath);
  const rawEntries = await fs.promises.readdir(absPath, {
    withFileTypes: true,
  });
  const entries: DirEntry[] = [];
  for (const dirent of rawEntries) {
    if (dirent.name === ".git") {
      continue;
    }
    let size = 0;
    try {
      const s = await fs.promises.stat(path.join(absPath, dirent.name));
      size = s.size;
    } catch {
      /* size 0 on stat failure */
    }
    entries.push({ name: dirent.name, is_dir: dirent.isDirectory(), size });
  }
  entries.sort((a, b) => {
    if (a.is_dir !== b.is_dir) {
      return a.is_dir ? -1 : 1;
    }

    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return entries;
}

/**
 * List all files in a session using `git ls-files`.
 *
 * Returns tracked files plus untracked non-ignored files, sorted
 * alphabetically. Falls back to an empty array if the git command fails.
 */
export async function listSessionFiles(id: string): Promise<string[]> {
  const root = sessionPath(id);

  const [tracked, untracked] = await Promise.all([
    git(root, ["ls-files"]).catch(() => ""),
    git(root, ["ls-files", "--others", "--exclude-standard"]).catch(() => ""),
  ]);

  const parse = (out: string) => out.split("\n").filter((l) => l.length > 0);

  const allFiles = [...new Set([...parse(tracked), ...parse(untracked)])];
  allFiles.sort((a, b) => a.localeCompare(b));

  return allFiles;
}

/** Entry returned by {@link resolveMentionPath}. */
export interface MentionDirEntry {
  name: string;
  is_dir: boolean;
}

/**
 * Resolve a mention path query and list the target directory contents.
 *
 * Handles `~` (home directory), absolute paths, and session-relative paths.
 * The `query` should be the directory portion of the mention (e.g. `src/`,
 * `~/Work/`, `/Users/douwe/`).
 *
 * Returns the resolved absolute path and sorted directory entries
 * (directories first, then alphabetical). Returns empty entries for
 * non-existent or non-directory paths.
 */
export async function resolveMentionPath(
  id: string,
  query: string,
  // Remote callers pass the roots browsing is confined to (the session worktree
  // plus registered projects), so a paired device can reference a backend file
  // in another project but can't enumerate `~/.ssh`, `/etc`, etc. Desktop passes
  // nothing and keeps the full-filesystem browse the local picker relies on.
  confineRoots?: string[],
): Promise<{ resolvedPath: string; entries: MentionDirEntry[] }> {
  const root = sessionPath(id);

  let resolved: string;
  if (confineRoots) {
    // Absolute/home queries reach other projects; relative stays in the session.
    resolved =
      query.startsWith("/") || query.startsWith("~")
        ? path.resolve(query.replace(/^~(?=\/|$)/, os.homedir()))
        : path.resolve(root, query);
    const allowed = [root, ...confineRoots].map((r) => path.resolve(r));
    const inside = allowed.some(
      (r) => resolved === r || resolved.startsWith(r + path.sep),
    );
    if (!inside) {
      return { resolvedPath: root, entries: [] };
    }
  } else if (query.startsWith("~/") || query === "~") {
    resolved = path.join(os.homedir(), query.slice(1));
  } else if (query.startsWith("/")) {
    resolved = query;
  } else {
    resolved = path.join(root, query);
  }

  // Remove trailing slash for stat/readdir
  resolved = resolved.replace(/\/+$/, "") || "/";

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolved);
  } catch {
    return { resolvedPath: resolved, entries: [] };
  }

  if (!stat.isDirectory()) {
    return { resolvedPath: resolved, entries: [] };
  }

  let rawEntries: fs.Dirent[];
  try {
    rawEntries = await fs.promises.readdir(resolved, { withFileTypes: true });
  } catch {
    return { resolvedPath: resolved, entries: [] };
  }

  const entries: MentionDirEntry[] = rawEntries
    .filter((d) => d.name !== ".git")
    .map((d) => ({ name: d.name, is_dir: d.isDirectory() }))
    .sort((a, b) => {
      if (a.is_dir !== b.is_dir) {
        return a.is_dir ? -1 : 1;
      }

      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

  return { resolvedPath: resolved, entries };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up the absolute session path for the given session ID.
 *
 * @throws string if no session with that ID is registered in appState.
 */
function sessionPath(id: string): string {
  const session = appState.sessions.get(id);
  if (!session) {
    throw `Session not found: ${id}`;
  }

  return session.path;
}

/**
 * Roots `read_file`/`write_file` may touch: every session worktree plus every
 * registered project root.
 *
 * Both commands are reachable by an admin-granted device now, so containment
 * can no longer be "whatever the renderer asked for". Registered projects are
 * in scope because the chat's edit/undo actions replay absolute paths from tool
 * events, which legitimately land in a linked project.
 */
export async function allowedFileRoots(): Promise<string[]> {
  const roots = await canonicalSessionRoots();
  for (const repoRoot of appState.repoRoots) {
    try {
      roots.push(await fs.promises.realpath(repoRoot));
    } catch {
      // Project directory is gone; it grants nothing.
    }
  }

  return roots;
}

/**
 * Resolve a session-relative (or absolute) path and assert the canonical
 * result — symlinks followed — sits inside {@link allowedFileRoots}.
 *
 * @throws string if the path cannot be resolved or escapes every allowed root.
 */
export async function resolveContainedPath(
  id: string,
  requested: string,
  options: { mustExist: boolean },
): Promise<string> {
  const root = sessionPath(id);
  const joined = path.isAbsolute(requested)
    ? requested
    : path.join(root, requested);
  const canonical = await canonicalize(joined, options.mustExist);

  for (const allowed of await allowedFileRoots()) {
    if (canonical === allowed || canonical.startsWith(allowed + path.sep)) {
      return canonical;
    }
  }

  throw `Path is outside this session and every registered project: ${requested}`;
}

/**
 * Resolve `relative` within `root` and assert the canonical result stays
 * inside `root`. Used for paths that must already exist on disk.
 *
 * @throws string if the path cannot be resolved or escapes the session root.
 */
async function resolveSafePath(
  root: string,
  relative: string,
): Promise<string> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await fs.promises.realpath(root);
  } catch (e) {
    throw `Failed to resolve session root: ${String(e)}`;
  }

  const joined = path.join(root, relative);
  let canonicalTarget: string;
  try {
    canonicalTarget = await fs.promises.realpath(joined);
  } catch (e) {
    throw `Failed to resolve path: ${String(e)}`;
  }

  if (
    !canonicalTarget.startsWith(canonicalRoot + path.sep) &&
    canonicalTarget !== canonicalRoot
  ) {
    throw "Path escapes session root";
  }

  return canonicalTarget;
}
