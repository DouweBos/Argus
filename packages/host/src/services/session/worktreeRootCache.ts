/**
 * Memo for resolved worktree roots.
 *
 * Its own module so the settings stores can invalidate it without importing
 * the resolver that reads them — that would be a cycle.
 */

export interface CachedWorktreeRoot {
  root: string;
  source: "app" | "default" | "project";
}

const cache = new Map<string, CachedWorktreeRoot>();

export function getCachedWorktreeRoot(
  repoRoot: string,
): CachedWorktreeRoot | undefined {
  return cache.get(repoRoot);
}

export function setCachedWorktreeRoot(
  repoRoot: string,
  value: CachedWorktreeRoot,
): void {
  cache.set(repoRoot, value);
}

/** Called whenever either settings store is written. */
export function invalidateWorktreeLocationCache(repoRoot?: string): void {
  if (repoRoot === undefined) {
    cache.clear();

    return;
  }
  cache.delete(repoRoot);
}
