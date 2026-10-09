/**
 * Tells clients to relist a project's sessions when a drive it uses is
 * connected or ejected, so availability isn't stuck at the last listing.
 */

import fs from "node:fs";
import { emitHostEvent } from "@argus/host/bus";
import { createLogger } from "@argus/host/logger";
import { appState } from "../../state";
import { forgetMountedVolumes, mountRootFor } from "./volumeAvailability";

const log = createLogger("session:volumes");

/** Mount/unmount fires a burst of events; one relist covers them all. */
const SETTLE_MS = 750;

export const VOLUMES_CHANGED_EVENT = "session:volumes-changed";

let watcher: fs.FSWatcher | null = null;
let timer: NodeJS.Timeout | null = null;

/** Repo roots with a session (or the repo itself) on a removable volume. */
export function reposOnVolumes(
  sessions: Iterable<{ path: string; repo_root: string }>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const repos = new Set<string>();
  for (const s of sessions) {
    if (mountRootFor(s.path, platform) || mountRootFor(s.repo_root, platform)) {
      repos.add(s.repo_root);
    }
  }

  return [...repos];
}

function notify(): void {
  timer = null;
  forgetMountedVolumes();
  for (const repoRoot of reposOnVolumes(appState.sessions.values())) {
    emitHostEvent(VOLUMES_CHANGED_EVENT, { repo_root: repoRoot });
  }
}

export function startVolumeWatcher(): void {
  if (watcher || process.platform !== "darwin") {
    return;
  }
  try {
    watcher = fs.watch("/Volumes", () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(notify, SETTLE_MS);
    });
    watcher.on("error", (err) => {
      log.warn("Volume watcher stopped", err);
      stopVolumeWatcher();
    });
  } catch (err) {
    log.warn("Could not watch /Volumes", err);
  }
}

export function stopVolumeWatcher(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  watcher?.close();
  watcher = null;
}
