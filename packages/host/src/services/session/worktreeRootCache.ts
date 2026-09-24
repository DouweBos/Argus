/**
 * Memo for resolved worktree roots.
 *
 * Its own module so the settings stores can invalidate it without importing
 * the resolver that reads them — that would be a cycle.
 */

export interface CachedWorktreeRoot {
  root: string;
  /** Hand-copied from `WorktreeRootSource`; importing it would be the cycle. */
  source:
    | "app"
    | "automation_app"
    | "automation_project"
    | "default"
    | "project";
}

/** Both purposes are cached per repo, so the key carries both. */
const PURPOSES = ["automation", "user"] as const;

function keyFor(repoRoot: string, purpose: string): string {
  return `${repoRoot}\0${purpose}`;
}

const cache = new Map<string, CachedWorktreeRoot>();

export function getCachedWorktreeRoot(
  repoRoot: string,
  purpose: string,
): CachedWorktreeRoot | undefined {
  return cache.get(keyFor(repoRoot, purpose));
}

export function setCachedWorktreeRoot(
  repoRoot: string,
  purpose: string,
  value: CachedWorktreeRoot,
): void {
  cache.set(keyFor(repoRoot, purpose), value);
}

/** Called whenever either settings store is written. */
export function invalidateWorktreeLocationCache(repoRoot?: string): void {
  if (repoRoot === undefined) {
    cache.clear();

    return;
  }
  for (const purpose of PURPOSES) {
    cache.delete(keyFor(repoRoot, purpose));
  }
}
