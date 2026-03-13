/**
 * File system watcher for workspace directories.
 *
 * TODO: Implement efficient file watching that works with large monorepos
 * (60K+ directories). The naive chokidar recursive watch hits macOS EMFILE
 * limits. Options to explore: fs.watch on tracked-file directories only,
 * or polling git diff on an interval.
 */

/** Diff statistics emitted to the frontend. */
export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

/** Handle to a running file watcher. */
export class WatcherHandle {
  stop(): void {}
  pause(): void {}
  resume(): void {}
}

/** Start a file system watcher on a workspace directory (currently a no-op). */
export function startWatcher(
  _workspaceId: string,
  _worktreePath: string,
): WatcherHandle {
  return new WatcherHandle();
}
