/**
 * Binary-safe file primitives for a remote git runner: the counterpart of
 * GroveKit's `GitRunner` file ops. Containment matches `read_file` — the
 * session worktree plus every registered project root, symlinks resolved.
 *
 * Errors are thrown as plain strings to match IPC error handling.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appState } from "../../state";
import { resolveContainedPath } from "./operations";

/** Stays under the 16 MB gateway frame once base64'd. */
const MAX_READ = 8 * 1024 * 1024;

export interface PathKind {
  kind: "directory" | "file";
}

/**
 * Resolve the parent and keep the leaf as-is, so remove/move act on a symlink
 * itself rather than whatever it points at. A containment root itself is never
 * a valid target.
 */
async function containedLeaf(id: string, requested: string): Promise<string> {
  const session = appState.sessions.get(id);
  if (!session) {
    throw `Session not found: ${id}`;
  }
  const absolute = path.resolve(session.path, requested);
  const parent = await resolveContainedPath(id, path.dirname(absolute), {
    mustExist: false,
  });
  const leaf = path.join(parent, path.basename(absolute));
  for (const root of [session.path, ...appState.repoRoots]) {
    const canonical = await fs.promises.realpath(root).catch(() => root);
    if (leaf === canonical) {
      throw `Refusing to touch a session or project root: ${requested}`;
    }
  }

  return leaf;
}

export async function readFileBytes(
  id: string,
  relativePath: string,
): Promise<string> {
  const target = await resolveContainedPath(id, relativePath, {
    mustExist: true,
  });
  const stat = await fs.promises.stat(target);
  if (!stat.isFile()) {
    throw `Not a file: ${relativePath}`;
  }
  if (stat.size > MAX_READ) {
    throw "File is too large (>8 MB)";
  }

  return (await fs.promises.readFile(target)).toString("base64");
}

/** Atomic: written beside the target, then renamed over it. */
export async function writeFileBytes(
  id: string,
  relativePath: string,
  data: string,
  executable = false,
): Promise<void> {
  const target = await resolveContainedPath(id, relativePath, {
    mustExist: false,
  });
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.argus-${crypto.randomBytes(6).toString("hex")}.tmp`;
  const mode = executable ? 0o755 : 0o644;
  try {
    await fs.promises.writeFile(temp, Buffer.from(data, "base64"), { mode });
    // `mode` on create is masked by the umask; the caller asked for this one.
    await fs.promises.chmod(temp, mode);
    await fs.promises.rename(temp, target);
  } catch (e) {
    await fs.promises.rm(temp, { force: true });
    throw `Failed to write file: ${String(e)}`;
  }
}

/** Null when nothing is there (a dangling symlink counts as nothing). */
export async function statPath(
  id: string,
  relativePath: string,
): Promise<PathKind | null> {
  const target = await resolveContainedPath(id, relativePath, {
    mustExist: false,
  });
  try {
    const stat = await fs.promises.stat(target);

    return { kind: stat.isDirectory() ? "directory" : "file" };
  } catch {
    return null;
  }
}

/** Entry names, sorted. */
export async function listDirectory(
  id: string,
  relativePath: string,
): Promise<string[]> {
  const target = await resolveContainedPath(id, relativePath, {
    mustExist: true,
  });

  return (await fs.promises.readdir(target)).sort();
}

/** Recursive. Missing is an error, like `FileManager.removeItem`. */
export async function removePath(
  id: string,
  relativePath: string,
): Promise<void> {
  const target = await containedLeaf(id, relativePath);
  await fs.promises.lstat(target).catch(() => {
    throw `No such file or directory: ${relativePath}`;
  });
  await fs.promises.rm(target, { recursive: true });
}

/** With parents; an existing directory is fine. */
export async function makeDirectory(
  id: string,
  relativePath: string,
): Promise<void> {
  const target = await resolveContainedPath(id, relativePath, {
    mustExist: false,
  });
  await fs.promises.mkdir(target, { recursive: true });
}

export async function movePath(
  id: string,
  from: string,
  to: string,
): Promise<void> {
  const source = await containedLeaf(id, from);
  const destination = await containedLeaf(id, to);
  try {
    await fs.promises.rename(source, destination);
  } catch (e) {
    throw `Failed to move ${from}: ${String(e)}`;
  }
}
