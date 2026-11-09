/** Sessions whose PR is watched — a leaf, so session listings can ask without importing the watcher. */

export const POLL_MS = 2 * 60_000;

const watched = new Set<string>();

export function isPullRequestWatched(sessionId: string): boolean {
  return watched.has(sessionId);
}

export function markPullRequestWatched(sessionId: string, on: boolean): void {
  if (on) {
    watched.add(sessionId);
  } else {
    watched.delete(sessionId);
  }
}

export function clearWatchedPullRequests(): void {
  watched.clear();
}
