/**
 * Remote enumeration + GitHub-issue autocomplete scaffolding (Phase 2 W10).
 *
 * Issue listing is a stub that returns `[]` until a future phase adds
 * GitHub-token UX. The frontend uses the remote-list to detect "GitHub remote
 * present" so the `#`-trigger can light up only when it's meaningful.
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

export interface GitRemote {
  name: string;
  url: string;
}

/** Return one entry per configured remote (deduped on `name`). */
export async function gitGetRemotes(id: string): Promise<GitRemote[]> {
  const wt = sessionPath(id);
  const raw = await git(wt, ["remote", "-v"]);
  const seen = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    // Format: "<name>\t<url> (fetch|push)"
    const match = trimmed.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) {
      continue;
    }
    if (!seen.has(match[1])) {
      seen.set(match[1], match[2]);
    }
  }

  return Array.from(seen.entries()).map(([name, url]) => ({ name, url }));
}

export interface RecentIssue {
  number: number;
  state: "closed" | "open";
  title: string;
}

/**
 * Stubbed GitHub-issue search. Returns `[]` until token UX lands. The
 * frontend renders an empty dropdown if no matches come back, which keeps
 * the typing UX sane.
 */
export async function gitListRecentIssues(
  _id: string,
  _query: string,
): Promise<RecentIssue[]> {
  return [];
}
