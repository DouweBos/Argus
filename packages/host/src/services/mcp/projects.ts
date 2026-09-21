/**
 * Registering a project Argus has not seen before.
 *
 * Discovery lives in `projectDiscovery.ts`; this is the half that mutates.
 */

import { appState } from "../../state";
import { addRepoRoot, createHeadSession } from "../session/manager";
import { isGitRepo } from "./projectDiscovery";

/**
 * Ensure a repo root is registered in appState. If not, register it and create
 * its head session so the UI shows it.
 */
export function ensureRepoRegistered(repoRoot: string): void {
  if (appState.repoRoots.has(repoRoot)) {
    return;
  }
  if (!isGitRepo(repoRoot)) {
    throw new Error(`Not a git repository: ${repoRoot}`);
  }
  addRepoRoot(repoRoot);
  createHeadSession(repoRoot);
}
