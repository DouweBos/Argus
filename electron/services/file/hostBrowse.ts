/**
 * Directory browsing for the *host's* filesystem.
 *
 * A native open dialog is host-only — it would draw on the machine with the
 * window, which in remote mode is the wrong Mac entirely. Picking a project
 * root on a host therefore needs a listing the client can render itself.
 *
 * Deliberately separate from `list_path`, which is confined to registered
 * session/project roots: choosing a *new* project root means walking a
 * filesystem nothing has registered yet. It returns directory names only —
 * never file contents — and is reachable only by an admin-granted device,
 * which is the same trust level as sitting at the host's keyboard.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface HostDirectoryEntry {
  is_repo: boolean;
  name: string;
  path: string;
}

export interface HostDirectoryListing {
  entries: HostDirectoryEntry[];
  home: string;
  parent: string | null;
  path: string;
}

async function isRepo(dir: string): Promise<boolean> {
  try {
    await fs.promises.access(path.join(dir, ".git"));

    return true;
  } catch {
    return false;
  }
}

export async function listHostDirectory(
  input?: string,
): Promise<HostDirectoryListing> {
  const home = os.homedir();
  const target = path.resolve(input?.trim() ? input : home);
  const dirents = await fs.promises.readdir(target, { withFileTypes: true });

  const entries: HostDirectoryEntry[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || dirent.name.startsWith(".")) {
      continue;
    }
    const full = path.join(target, dirent.name);
    entries.push({
      name: dirent.name,
      path: full,
      is_repo: await isRepo(full),
    });
  }
  entries.sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );

  const parent = path.dirname(target);

  return {
    path: target,
    parent: parent === target ? null : parent,
    home,
    entries,
  };
}
