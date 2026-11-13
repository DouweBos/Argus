/**
 * What the cleanup remembers between runs: when each session was first seen
 * merged or its pull request closed, and the last sweep. Machine-local, in
 * `<argusHome>/worktree-cleanup.json`.
 */

import type { WorktreeCleanupSweep } from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";

interface CleanupState {
  /** Session id → epoch ms it was first seen landed. */
  landed: Record<string, number>;
  last_sweep: WorktreeCleanupSweep | null;
}

function filePath(): string {
  return path.join(argusHomeDir(), "worktree-cleanup.json");
}

export function loadCleanupState(): CleanupState {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath(), "utf8"),
    ) as Partial<CleanupState>;

    return {
      landed: parsed.landed ?? {},
      last_sweep: parsed.last_sweep ?? null,
    };
  } catch {
    return { landed: {}, last_sweep: null };
  }
}

export function saveCleanupState(state: CleanupState): void {
  const target = filePath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(`${target}.tmp`, target);
  } catch (e) {
    warn("worktreeCleanup: couldn't save state:", e);
  }
}

/** Keeps the first time only: a later merge of the same session changes nothing. */
export function markLanded(sessionId: string, at = Date.now()): void {
  const state = loadCleanupState();
  if (state.landed[sessionId] !== undefined) {
    return;
  }
  state.landed[sessionId] = at;
  saveCleanupState(state);
}
