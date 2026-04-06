/**
 * File operations service — list, read, and write files inside a workspace.
 *
 * All functions resolve paths relative to the workspace root and reject any
 * path that escapes it.
 *
 * Errors are thrown as plain strings to match IPC error handling.
 */

import fs from "fs";
import path from "path";

import { appState } from "../../state";

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
 * List the contents of a directory inside a workspace.
 *
 * Returns entries sorted directories-first, then alphabetical
 * (case-insensitive). The `.git` directory is filtered out at the root level.
 *
 * @throws string if the workspace is not found, the path escapes the root, or
 *   the directory cannot be read.
 */
export async function listDirectory(
  id: string,
  relativePath: string,
): Promise<DirEntry[]> {
  const root = workspacePath(id);
  const target = await resolveSafePath(root, relativePath);

  let rawEntries: fs.Dirent[];
  try {
    rawEntries = await fs.promises.readdir(target, { withFileTypes: true });
  } catch (e) {
    throw `Failed to read directory: ${String(e)}`;
  }

  const entries: DirEntry[] = [];

  for (const dirent of rawEntries) {
    // Filter .git at the workspace root level only
    if (relativePath === "" && dirent.name === ".git") {
      continue;
    }

    let size = 0;
    try {
      const stat = await fs.promises.stat(path.join(target, dirent.name));
      size = stat.size;
    } catch {
      // If stat fails, include the entry with size 0 rather than dropping it
    }

    entries.push({
      name: dirent.name,
      is_dir: dirent.isDirectory(),
      size,
    });
  }

  // Sort: directories first, then alphabetical (case-insensitive)
  entries.sort((a, b) => {
    if (a.is_dir !== b.is_dir) {
      return a.is_dir ? -1 : 1;
    }
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return entries;
}

/**
 * Read a text file from a workspace.
 *
 * Rejects binary files (null bytes in the first 8 KB) and files larger than
 * 5 MB.
 *
 * @throws string if the workspace is not found, the path escapes the root,
 *   the file is binary, the file is too large, or the file cannot be read.
 */
export async function readFile(
  id: string,
  relativePath: string,
): Promise<string> {
  const root = workspacePath(id);
  const target = await resolveSafePath(root, relativePath);

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
 * Write a text file to a workspace.
 *
 * Creates parent directories if they do not already exist.
 *
 * @throws string if the workspace is not found, the path escapes the root, or
 *   the file cannot be written.
 */
/**
 * Stat a file or directory inside a workspace.
 *
 * Returns type (file/directory), size, and mtime.
 *
 * @throws string if the workspace is not found, the path escapes the root,
 *   or the file cannot be stat'd.
 */
export async function statFile(
  id: string,
  relativePath: string,
): Promise<{ is_dir: boolean; size: number; mtime: number }> {
  const root = workspacePath(id);
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
  const root = workspacePath(id);

  // Resolve the target path. For new files the final path component will not
  // exist yet, so we resolve only the parent to validate containment and then
  // re-join the filename.
  const joined = path.join(root, relativePath);
  const parent = path.dirname(joined);
  const filename = path.basename(joined);

  const safeParent = await resolveSafeDir(root, parent);
  const target = path.join(safeParent, filename);

  try {
    await fs.promises.mkdir(safeParent, { recursive: true });
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
// known workspace before performing any I/O.
// ---------------------------------------------------------------------------

/**
 * Assert that an absolute path is inside a registered workspace.
 * @throws string if the path is not inside any workspace.
 */
function assertInsideWorkspace(absPath: string): void {
  const normalized = path.normalize(absPath);
  for (const ws of appState.workspaces.values()) {
    const wsPath = path.normalize(ws.path);
    if (normalized === wsPath || normalized.startsWith(wsPath + path.sep)) {
      return;
    }
  }
  throw `Path is not inside any workspace: ${absPath}`;
}

/** Stat an absolute path. */
export async function statPath(
  absPath: string,
): Promise<{ is_dir: boolean; size: number; mtime: number }> {
  assertInsideWorkspace(absPath);
  const stat = await fs.promises.stat(absPath);
  return { is_dir: stat.isDirectory(), size: stat.size, mtime: stat.mtimeMs };
}

/** Read a text file at an absolute path. */
export async function readPath(absPath: string): Promise<string> {
  assertInsideWorkspace(absPath);
  return fs.promises.readFile(absPath, "utf8");
}

/** Write a text file at an absolute path, creating parent dirs as needed. */
export async function writePath(
  absPath: string,
  content: string,
): Promise<void> {
  assertInsideWorkspace(absPath);
  await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
  await fs.promises.writeFile(absPath, content, "utf8");
}

/** List directory contents at an absolute path. */
export async function listPath(absPath: string): Promise<DirEntry[]> {
  assertInsideWorkspace(absPath);
  const rawEntries = await fs.promises.readdir(absPath, {
    withFileTypes: true,
  });
  const entries: DirEntry[] = [];
  for (const dirent of rawEntries) {
    if (dirent.name === ".git") continue;
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
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return entries;
}

/** Create a directory at an absolute path (recursive). */
export async function mkdirPath(absPath: string): Promise<void> {
  assertInsideWorkspace(absPath);
  await fs.promises.mkdir(absPath, { recursive: true });
}

/** Delete a file or directory at an absolute path. */
export async function deletePath(absPath: string): Promise<void> {
  assertInsideWorkspace(absPath);
  const stat = await fs.promises.stat(absPath);
  if (stat.isDirectory()) {
    await fs.promises.rm(absPath, { recursive: true });
  } else {
    await fs.promises.unlink(absPath);
  }
}

/** Rename/move a file at an absolute path. */
export async function renamePath(from: string, to: string): Promise<void> {
  assertInsideWorkspace(from);
  assertInsideWorkspace(to);
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  await fs.promises.rename(from, to);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up the absolute workspace path for the given workspace ID.
 *
 * @throws string if no workspace with that ID is registered in appState.
 */
function workspacePath(id: string): string {
  const workspace = appState.workspaces.get(id);
  if (!workspace) {
    throw `Workspace not found: ${id}`;
  }
  return workspace.path;
}

/**
 * Resolve `relative` within `root` and assert the canonical result stays
 * inside `root`. Used for paths that must already exist on disk.
 *
 * @throws string if the path cannot be resolved or escapes the workspace root.
 */
async function resolveSafePath(
  root: string,
  relative: string,
): Promise<string> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await fs.promises.realpath(root);
  } catch (e) {
    throw `Failed to resolve workspace root: ${String(e)}`;
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
    throw "Path escapes workspace root";
  }

  return canonicalTarget;
}

/**
 * Variant of {@link resolveSafePath} for a directory that may not yet exist.
 *
 * Resolves as many path components as do exist, then verifies containment
 * using string prefix matching on the normalized path.
 *
 * @throws string if the resolved directory escapes the workspace root.
 */
async function resolveSafeDir(root: string, dir: string): Promise<string> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await fs.promises.realpath(root);
  } catch (e) {
    throw `Failed to resolve workspace root: ${String(e)}`;
  }

  // Normalise without requiring the path to exist
  const normalised = path.normalize(dir);

  if (
    normalised !== canonicalRoot &&
    !normalised.startsWith(canonicalRoot + path.sep)
  ) {
    throw "Path escapes workspace root";
  }

  return normalised;
}
