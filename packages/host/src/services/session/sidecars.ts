/**
 * Per-project files Argus keeps beside the worktrees — chat history and
 * command metrics. They sit under the user worktree root, so changing that
 * root without moving the worktrees would orphan them; `sidecarPath` adopts a
 * copy stranded at an earlier root instead.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "../../logger";
import { worktreesRoot } from "./git";
import { isOnMissingVolume } from "./volumeAvailability";
import { worktreeRootsForRepo } from "./worktreeLocation";

export const CHAT_HISTORY_DIR = ".argus-chat-history";
export const COMMAND_METRICS_FILE = ".argus-command-metrics.json";

const SIDECARS = [CHAT_HISTORY_DIR, COMMAND_METRICS_FILE];

function moveSidecar(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  fs.rmSync(from, { recursive: true, force: true });
}

/** Where a sidecar lives now, pulling it over from an earlier root if needed. */
export function sidecarPath(repoRoot: string, name: string): string {
  const current = path.join(worktreesRoot(repoRoot, "user"), name);
  if (fs.existsSync(current)) {
    return current;
  }

  for (const root of worktreeRootsForRepo(repoRoot)) {
    const stranded = path.join(root, name);
    if (stranded === current || !fs.existsSync(stranded)) {
      continue;
    }
    // Drive unplugged: keep using the old copy rather than lose it.
    if (isOnMissingVolume(current)) {
      return stranded;
    }
    try {
      moveSidecar(stranded, current);

      return current;
    } catch (e) {
      warn(`sidecars: could not adopt ${stranded}: ${String(e)}`);

      return stranded;
    }
  }

  return current;
}

export function moveSidecars(fromRoot: string, toRoot: string): void {
  for (const name of SIDECARS) {
    const from = path.join(fromRoot, name);
    if (!fs.existsSync(from)) {
      continue;
    }
    try {
      moveSidecar(from, path.join(toRoot, name));
    } catch (e) {
      warn(`moveWorktrees: could not move ${name}: ${String(e)}`);
    }
  }
}
