/**
 * Frontend mirror of `electron/services/session/gitError.ts`.
 *
 * The renderer must not import electron-side code, so this is a separate
 * file with the same `kind` union and a runtime class. IPC errors that
 * carry the `__gitError` envelope are rehydrated into a `GitError`
 * instance by the IPC wrapper in `app/lib/ipc.ts`.
 */

export type GitErrorKind =
  | "auth-required"
  | "branch-checked-out"
  | "busy"
  | "cherry-pick-conflict"
  | "detached-head"
  | "dirty-working-tree"
  | "hook-failed"
  | "lfs-missing"
  | "lock-file-exists"
  | "merge-conflict"
  | "network-timeout"
  | "no-upstream"
  | "non-fast-forward"
  | "nothing-to-commit"
  | "nothing-to-pull"
  | "nothing-to-push"
  | "rebase-conflict"
  | "unknown";

export interface GitErrorPayload {
  __gitError: true;
  kind: GitErrorKind;
  message: string;
  recovery?: string;
  stderr?: string;
}

export class GitError extends Error {
  public readonly kind: GitErrorKind;
  public readonly stderr?: string;
  public readonly recovery?: string;

  constructor(
    kind: GitErrorKind,
    message: string,
    options?: { recovery?: string; stderr?: string },
  ) {
    super(message);
    this.name = "GitError";
    this.kind = kind;
    this.stderr = options?.stderr;
    this.recovery = options?.recovery;
  }
}

/**
 * Inspect a thrown value (typically the rejection of `window.argus.invoke`)
 * and rebuild a typed `GitError` if it carries the `__gitError` envelope.
 */
export function rehydrateGitError(err: unknown): GitError | null {
  if (err instanceof GitError) {
    return err;
  }
  if (typeof err !== "object" || err === null) {
    return null;
  }
  const e = err as Record<string, unknown>;
  if (e.__gitError !== true) {
    return null;
  }
  const kind = typeof e.kind === "string" ? (e.kind as GitErrorKind) : null;
  const message = typeof e.message === "string" ? e.message : "";
  if (!kind) {
    return null;
  }

  return new GitError(kind, message, {
    stderr: typeof e.stderr === "string" ? e.stderr : undefined,
    recovery: typeof e.recovery === "string" ? e.recovery : undefined,
  });
}
