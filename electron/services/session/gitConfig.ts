/**
 * Per-repo git config read/write (Phase 2 W10).
 *
 * Used by the commit composer to surface the GPG/SSH sign toggle
 * (`commit.gpgsign`).
 */

import { appState } from "../../state";
import { git } from "./git";

function sessionPath(id: string): string {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }

  return ws.path;
}

/** Return a config value or `null` if it isn't set. */
export async function gitGetConfig(
  id: string,
  key: string,
): Promise<string | null> {
  const wt = sessionPath(id);
  try {
    const out = await git(wt, ["config", "--local", "--get", key]);

    return out.trim();
  } catch {
    return null;
  }
}

/**
 * Write a config value to the local repo (worktree-scoped). Pass an
 * empty string to clear (uses `--unset`).
 */
export async function gitSetConfig(
  id: string,
  key: string,
  value: string,
): Promise<void> {
  const wt = sessionPath(id);
  if (value === "") {
    try {
      await git(wt, ["config", "--local", "--unset", key]);
    } catch {
      // unset on a missing key is fine.
    }

    return;
  }
  await git(wt, ["config", "--local", key, value]);
}
