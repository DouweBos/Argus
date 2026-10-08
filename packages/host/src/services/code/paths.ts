/**
 * Mapping between what clients send (session-relative paths) and what the
 * filesystem and language servers see (canonical absolute paths).
 */

import fs from "node:fs";
import path from "node:path";
import { appState } from "../../state";
import { allowedFileRoots } from "../file/operations";

export function sessionRoot(id: string): string {
  const session = appState.sessions.get(id);
  if (!session) {
    throw `Session not found: ${id}`;
  }

  return session.path;
}

/** The worktree with symlinks resolved; falls back to the path as stored. */
export function canonicalSessionRoot(id: string): string {
  const root = sessionRoot(id);
  try {
    return fs.realpathSync(root);
  } catch {
    return root;
  }
}

function within(root: string, target: string): string | null {
  const rel = path.relative(root, target);
  if (rel === "") {
    return "";
  }

  return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;
}

/**
 * How a client names `absolute`: relative to the session when it's inside,
 * absolute when it's in another allowed root, null when it's outside them all.
 */
export async function clientPath(
  id: string,
  absolute: string,
): Promise<string | null> {
  for (const root of new Set([sessionRoot(id), canonicalSessionRoot(id)])) {
    const rel = within(root, absolute);
    if (rel !== null && rel !== "") {
      return rel.split(path.sep).join("/");
    }
  }
  let canonical = absolute;
  try {
    canonical = await fs.promises.realpath(absolute);
  } catch {
    // A file that doesn't exist (yet) is judged by its path.
  }
  const sessionRel = within(canonicalSessionRoot(id), canonical);
  if (sessionRel) {
    return sessionRel.split(path.sep).join("/");
  }
  for (const root of await allowedFileRoots()) {
    if (within(root, canonical) !== null) {
      return canonical;
    }
  }

  return null;
}
