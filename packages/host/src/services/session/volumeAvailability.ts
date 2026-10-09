/**
 * Tells "this volume isn't mounted" apart from "this directory was deleted".
 *
 * The two look identical to `existsSync` and have opposite consequences: a
 * deleted worktree should be pruned, an unplugged one must be left completely
 * alone. Conflating them is how an ejected drive turns into lost work —
 * `git worktree prune` drops the admin dir, and after that neither `repair`
 * nor a remount brings the worktree back.
 */

import fs from "node:fs";
import path from "node:path";

export type PathAvailability =
  | { state: "deleted" }
  | { state: "present" }
  | { state: "volume_missing"; volume: string };

export interface ClassifyDeps {
  exists: (p: string) => boolean;
  /** Whether a volume is actually mounted, not merely an existing folder. */
  mounted: (volume: string) => boolean;
  platform: NodeJS.Platform;
}

/**
 * The mount point a path depends on, or null when it lives on the boot volume
 * (which is always there, so a missing path under it is genuinely deleted).
 *
 * macOS is exact — `/Volumes/<name>` simply ceases to exist on eject. The
 * other platforms are a best-effort match on the conventional removable-media
 * directories; a bind mount at an arbitrary path reads as the boot volume.
 */
export function mountRootFor(
  target: string,
  platform: NodeJS.Platform,
): string | null {
  const segments = target.split(path.sep).filter(Boolean);

  if (platform === "darwin") {
    return segments[0] === "Volumes" && segments.length >= 2
      ? `${path.sep}${segments[0]}${path.sep}${segments[1]}`
      : null;
  }

  if (platform === "win32") {
    const drive = /^([A-Za-z]):/.exec(target)?.[1];

    return drive && drive.toUpperCase() !== "C" ? `${drive}:\\` : null;
  }

  // Linux: /media/<user>/<name>, /run/media/<user>/<name>, /mnt/<name>.
  if (segments[0] === "mnt" && segments.length >= 2) {
    return `/mnt/${segments[1]}`;
  }
  if (segments[0] === "media" && segments.length >= 3) {
    return `/media/${segments[1]}/${segments[2]}`;
  }
  if (
    segments[0] === "run" &&
    segments[1] === "media" &&
    segments.length >= 4
  ) {
    return `/run/media/${segments[2]}/${segments[3]}`;
  }

  return null;
}

/** Pure core — all disk access injected, so this is the unit-tested seam. */
export function classifyPath(
  target: string,
  deps: ClassifyDeps,
): PathAvailability {
  if (deps.exists(target)) {
    return { state: "present" };
  }

  const volume = mountRootFor(target, deps.platform);
  if (!volume || deps.mounted(volume)) {
    return { state: "deleted" };
  }

  return { state: "volume_missing", volume };
}

/**
 * Cached by mount root: this sits on the session-list refresh, and a stat per
 * worktree per poll is waste when a whole volume appears or vanishes at once.
 */
const CACHE_TTL_MS = 2_000;
const volumeCache = new Map<string, { at: number; present: boolean }>();

/**
 * macOS can leave an empty `/Volumes/<name>` behind after an unclean eject, so
 * existing isn't enough: a real mount sits on a different device than its parent.
 */
export function isMounted(volume: string): boolean {
  if (process.platform === "win32") {
    return fs.existsSync(volume);
  }
  try {
    return fs.statSync(volume).dev !== fs.statSync(path.dirname(volume)).dev;
  } catch {
    return false;
  }
}

function mountedCached(volume: string): boolean {
  const hit = volumeCache.get(volume);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return hit.present;
  }
  const present = isMounted(volume);
  volumeCache.set(volume, { at: now, present });

  return present;
}

/** A drive just came or went: the next check must look again. */
export function forgetMountedVolumes(): void {
  volumeCache.clear();
}

export function pathAvailability(target: string): PathAvailability {
  // Only the mount root is cached — the target itself is cheap and changes
  // for reasons that have nothing to do with the volume.
  if (fs.existsSync(target)) {
    return { state: "present" };
  }

  const volume = mountRootFor(target, process.platform);
  if (!volume || mountedCached(volume)) {
    return { state: "deleted" };
  }

  return { state: "volume_missing", volume };
}

/** True when the path is unreachable because its drive isn't connected. */
export function isOnMissingVolume(target: string): boolean {
  return pathAvailability(target).state === "volume_missing";
}

/** Human name of a volume, for messages: "/Volumes/Blackbox" -> "Blackbox". */
export function volumeLabel(volume: string): string {
  return path.basename(volume) || volume;
}

/**
 * Throw a message that says which of the two problems this is — "reconnect the
 * drive" and "the folder is gone" call for very different responses.
 */
export function assertWorktreePresent(worktreePath: string): void {
  const availability = pathAvailability(worktreePath);
  if (availability.state === "present") {
    return;
  }
  if (availability.state === "volume_missing") {
    throw `This session is stored on ${volumeLabel(availability.volume)}, which isn't connected. Reconnect the drive and try again.`;
  }

  throw `Session worktree not found at ${worktreePath}`;
}

/**
 * Refuse to create a worktrees directory on a drive that isn't connected.
 *
 * `mkdirSync -p` under an absent mount point succeeds against the boot disk
 * and then shadows the real volume when it is plugged back in, which is far
 * more confusing than an error.
 */
export function assertWorktreeBaseAvailable(baseDir: string): void {
  const availability = pathAvailability(baseDir);
  if (availability.state !== "volume_missing") {
    return;
  }

  throw `${volumeLabel(availability.volume)} isn't connected. Reconnect the drive, or change the worktree location this session uses.`;
}

/**
 * Refuse only when the drive is disconnected.
 *
 * Unlike {@link assertWorktreePresent}, a path that is simply gone is fine —
 * for a cleanup that is the normal case, and the thing worth stopping is
 * acting on files that exist but cannot currently be seen.
 */
export function assertVolumeConnected(target: string): void {
  const availability = pathAvailability(target);
  if (availability.state !== "volume_missing") {
    return;
  }

  throw `${volumeLabel(availability.volume)} isn't connected, so Argus can't safely change anything there. Reconnect the drive and try again.`;
}

/** Test seam — drops the mount-root cache. */
export function resetAvailabilityCache(): void {
  volumeCache.clear();
}
