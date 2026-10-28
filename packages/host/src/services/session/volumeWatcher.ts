/**
 * Tells clients to relist a project's sessions when a drive it uses is
 * connected or ejected, so availability isn't stuck at the last listing.
 */

import fs from "node:fs";
import { emitHostEvent } from "@argus/host/bus";
import { createLogger } from "@argus/host/logger";
import { appState } from "../../state";
import { restoreRepoRoots } from "./manager";
import { loadMetadata } from "./metadata";
import { forgetMountedVolumes, mountRootFor } from "./volumeAvailability";

const log = createLogger("session:volumes");

/** Mount/unmount fires a burst of events; one relist covers them all. */
const SETTLE_MS = 750;

/** FSEvents drops mount/unmount notifications, so a listing poll backs the watch up. */
const POLL_MS = 5_000;

export const VOLUMES_CHANGED_EVENT = "session:volumes-changed";

let watcher: fs.FSWatcher | null = null;
let timer: NodeJS.Timeout | null = null;
let poll: NodeJS.Timeout | null = null;
let lastListing: string | null = null;

/**
 * Repo roots with a session (or the repo itself) on a removable volume.
 * `indexed` covers sessions only the metadata index knows — a drive that was
 * away at launch leaves them out of `appState`.
 */
export function reposOnVolumes(
  sessions: Iterable<{ path: string; repo_root: string }>,
  platform: NodeJS.Platform = process.platform,
  indexed: Iterable<{ repo_root: string; paths: Iterable<string> }> = [],
): string[] {
  const onVolume = (p: string) => mountRootFor(p, platform) !== null;
  const repos = new Set<string>();
  for (const s of sessions) {
    if (onVolume(s.path) || onVolume(s.repo_root)) {
      repos.add(s.repo_root);
    }
  }
  for (const repo of indexed) {
    if (onVolume(repo.repo_root) || [...repo.paths].some(onVolume)) {
      repos.add(repo.repo_root);
    }
  }

  return [...repos];
}

function indexedSessions(): { repo_root: string; paths: string[] }[] {
  return [...appState.repoRoots].map((repoRoot) => {
    try {
      return { repo_root: repoRoot, paths: [...loadMetadata(repoRoot).keys()] };
    } catch {
      return { repo_root: repoRoot, paths: [] };
    }
  });
}

function notify(): void {
  timer = null;
  forgetMountedVolumes();
  // A project whose root is on the drive was skipped at launch; register it now.
  restoreRepoRoots();
  const repos = reposOnVolumes(
    appState.sessions.values(),
    process.platform,
    indexedSessions(),
  );
  for (const repoRoot of repos) {
    emitHostEvent(VOLUMES_CHANGED_EVENT, { repo_root: repoRoot });
  }
}

function schedule(): void {
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(notify, SETTLE_MS);
}

function readVolumes(): string | null {
  try {
    return fs.readdirSync("/Volumes").sort().join("\n");
  } catch {
    return null;
  }
}

function pollVolumes(): void {
  const listing = readVolumes();
  if (listing !== lastListing) {
    lastListing = listing;
    schedule();
  }
}

export function startVolumeWatcher(): void {
  if (watcher || poll || process.platform !== "darwin") {
    return;
  }
  lastListing = readVolumes();
  poll = setInterval(pollVolumes, POLL_MS);
  poll.unref();
  try {
    watcher = fs.watch("/Volumes", schedule);
    watcher.on("error", (err) => {
      log.warn("Volume watcher stopped; polling only", err);
      watcher?.close();
      watcher = null;
    });
  } catch (err) {
    log.warn("Could not watch /Volumes; polling only", err);
  }
}

export function stopVolumeWatcher(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (poll) {
    clearInterval(poll);
    poll = null;
  }
  watcher?.close();
  watcher = null;
  lastListing = null;
}
