/**
 * Per-project files that used to sit beside the worktrees — chat history and
 * command metrics. They cover the whole project, root session included, so
 * they live on the boot disk: an unplugged worktree drive must not take them
 * with it. Copies left under any worktree root are folded in on first use.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "../../logger";
import { projectDataDir } from "./metadata";
import { isOnMissingVolume } from "./volumeAvailability";
import { worktreeRootsForRepo } from "./worktreeLocation";

export const CHAT_HISTORY_DIR = ".argus-chat-history";
export const COMMAND_METRICS_FILE = ".argus-command-metrics.json";

/** Folds a stray copy into one that already exists at the target. */
export type SidecarMerge = (from: string, to: string) => void;

const adopted = new Set<string>();

export function sidecarPath(
  repoRoot: string,
  name: string,
  merge: SidecarMerge,
): string {
  const target = path.join(projectDataDir(repoRoot), name);
  const key = `${repoRoot}\0${name}`;
  if (adopted.has(key)) {
    return target;
  }

  // Unreachable strays are retried on a later call, once the drive is back.
  let complete = true;
  for (const root of worktreeRootsForRepo(repoRoot)) {
    const stray = path.join(root, name);
    if (!fs.existsSync(stray)) {
      if (isOnMissingVolume(stray)) {
        complete = false;
      }
      continue;
    }
    try {
      if (fs.existsSync(target)) {
        merge(stray, target);
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.cpSync(stray, target, { recursive: true });
      }
      fs.rmSync(stray, { recursive: true, force: true });
    } catch (e) {
      complete = false;
      warn(`sidecars: could not adopt ${stray}: ${String(e)}`);
    }
  }
  if (complete) {
    adopted.add(key);
  }

  return target;
}
