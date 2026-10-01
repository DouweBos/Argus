/**
 * One host per `ARGUS_HOME`.
 *
 * Two hosts on the same state directory would both restore the same sessions,
 * reap each other's agents as orphans and race on every JSON store. Whoever
 * starts a host — the Electron app, the Mac app's bundled Node host, the CLI —
 * takes `$ARGUS_HOME/host.lock` first and refuses to start while someone else
 * holds it.
 *
 * Node has no `flock`, so this is a pid lock: created with `O_EXCL`, and
 * reclaimed only when the recorded process is gone.
 */

import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "./argusHome";

export type HostLockOwner = "cli" | "electron" | "mac";

export interface HostLockRecord {
  /** The process running the host core. */
  pid: number;
  /**
   * The app to ask to quit. For the Mac app that is the Swift process
   * supervising the Node host — killing the host alone would just get it
   * restarted.
   */
  owner_pid: number;
  owner: HostLockOwner;
  started_at: number;
}

export type HostLockResult =
  | { ok: false; holder: HostLockRecord }
  | { ok: true; release: () => void };

export function hostLockPath(home = argusHomeDir()): string {
  return path.join(home, "host.lock");
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);

    return true;
  } catch (err) {
    // EPERM: it exists, it just isn't ours to signal.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseRecord(raw: string): HostLockRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<HostLockRecord>;
    if (typeof value.pid !== "number") {
      return null;
    }

    return {
      pid: value.pid,
      owner_pid:
        typeof value.owner_pid === "number" ? value.owner_pid : value.pid,
      owner:
        value.owner === "electron" || value.owner === "mac"
          ? value.owner
          : "cli",
      started_at: typeof value.started_at === "number" ? value.started_at : 0,
    };
  } catch {
    return null;
  }
}

/** The live holder of the lock, or null when it is free (or stale). */
export function readHostLock(home = argusHomeDir()): HostLockRecord | null {
  let raw: string;
  try {
    raw = fs.readFileSync(hostLockPath(home), "utf8");
  } catch {
    return null;
  }
  const record = parseRecord(raw);

  return record && isAlive(record.pid) ? record : null;
}

/**
 * Take the lock for this process. A lock left by a process that no longer
 * exists is reclaimed; a live one is reported back so the caller can tell the
 * user who has it.
 */
export function acquireHostLock(
  owner: HostLockOwner,
  options: { home?: string; ownerPid?: number } = {},
): HostLockResult {
  const home = options.home ?? argusHomeDir();
  const file = hostLockPath(home);
  fs.mkdirSync(home, { recursive: true });
  const record: HostLockRecord = {
    pid: process.pid,
    owner_pid: options.ownerPid ?? process.pid,
    owner,
    started_at: Date.now(),
  };

  // Two rounds: the second only after removing a stale lock, so a racing
  // reclaimer that got there first wins and we report it.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(record), {
        flag: "wx",
        mode: 0o600,
      });

      return { ok: true, release: () => releaseHostLock(home) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw err;
      }
    }
    const holder = readHostLock(home);
    if (holder) {
      if (holder.pid === process.pid) {
        return { ok: true, release: () => releaseHostLock(home) };
      }

      return { ok: false, holder };
    }
    try {
      fs.unlinkSync(file);
    } catch {
      // Someone else reclaimed it between our read and unlink.
    }
  }
  const holder = readHostLock(home);
  if (holder) {
    return { ok: false, holder };
  }
  throw new Error(`could not take ${file}`);
}

/** Drop the lock, but only if this process still holds it. */
export function releaseHostLock(home = argusHomeDir()): void {
  const file = hostLockPath(home);
  try {
    const record = parseRecord(fs.readFileSync(file, "utf8"));
    if (record?.pid === process.pid) {
      fs.unlinkSync(file);
    }
  } catch {
    // Already gone.
  }
}

/** Resolves true once nobody holds the lock, false on timeout. */
export async function waitForHostLockRelease(
  timeoutMs: number,
  home = argusHomeDir(),
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (readHostLock(home)) {
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return true;
}
