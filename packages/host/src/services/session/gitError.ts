/**
 * Typed git error class + stderr classifier.
 *
 * Replaces raw-string throws from `git()`. Errors are classified into a
 * stable `kind` union so the frontend can render specific recovery actions
 * for each error type (see spec §7).
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
  | "output-too-large"
  | "rebase-conflict"
  | "signing-failed"
  | "unknown";

export interface GitErrorPayload {
  __gitError: true;
  kind: GitErrorKind;
  message: string;
  stderr?: string;
  recovery?: string;
}

/**
 * Structured git error. Crosses the IPC boundary as a `GitErrorPayload` (see
 * `serializeGitError`) so the renderer can rehydrate a typed `GitError` on
 * the FE side.
 */
export class GitError extends Error {
  public readonly kind: GitErrorKind;
  public readonly stderr?: string;
  public readonly recovery?: string;

  constructor(
    kind: GitErrorKind,
    message: string,
    options?: { stderr?: string; recovery?: string },
  ) {
    super(message);
    this.name = "GitError";
    this.kind = kind;
    this.stderr = options?.stderr;
    this.recovery = options?.recovery;
  }

  toPayload(): GitErrorPayload {
    return {
      __gitError: true,
      kind: this.kind,
      message: this.message,
      ...(this.stderr !== undefined && { stderr: this.stderr }),
      ...(this.recovery !== undefined && { recovery: this.recovery }),
    };
  }
}

/** Serialise a GitError for transport across IPC. */
export function serializeGitError(err: GitError): GitErrorPayload {
  return err.toPayload();
}

/** Type-guard for GitError payloads received from IPC. */
export function isGitErrorPayload(value: unknown): value is GitErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __gitError?: unknown }).__gitError === true &&
    typeof (value as { kind?: unknown }).kind === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

interface ClassifyHint {
  op?: string;
}

/**
 * Pattern-match the combined stderr (and optional stdout) of a failed git
 * invocation against known error signatures. Falls back to `unknown`.
 */
export function classifyGitStderr(
  stderr: string,
  hint?: ClassifyHint,
): GitError {
  const s = stderr || "";

  // Branch is already checked out in another worktree.
  if (/is already (?:used by|checked out at) worktree/i.test(s)) {
    const worktreeMatch = s.match(/worktree at ['"]?([^'"\n]+?)['"]?\s*$/m);
    const worktreePath = worktreeMatch?.[1]?.trim();
    const message = worktreePath
      ? `Branch is already checked out in worktree at ${worktreePath}`
      : "Branch is already checked out in another worktree";

    return new GitError("branch-checked-out", message, { stderr: s });
  }

  // index.lock — concurrent process holding the index.
  if (/index\.lock/.test(s) || /unable to create '.*\.lock'/i.test(s)) {
    return new GitError(
      "lock-file-exists",
      "Another git process is holding the index lock",
      { stderr: s },
    );
  }

  // No upstream branch configured for push/pull.
  if (
    /no upstream branch/i.test(s) ||
    /there is no tracking information/i.test(s) ||
    /the current branch .* has no upstream/i.test(s)
  ) {
    return new GitError("no-upstream", "Branch has no upstream configured", {
      stderr: s,
      recovery: "publish-branch",
    });
  }

  // Non-fast-forward push rejection.
  if (
    /updates were rejected because the tip/i.test(s) ||
    /non-fast-forward/i.test(s) ||
    /failed to push some refs/i.test(s)
  ) {
    return new GitError(
      "non-fast-forward",
      "Push rejected: remote has changes you don't have locally",
      { stderr: s, recovery: "pull-then-push" },
    );
  }

  // Authentication / credential failures.
  if (
    /authentication failed/i.test(s) ||
    /could not read username/i.test(s) ||
    /permission denied \(publickey\)/i.test(s) ||
    /fatal: could not read password/i.test(s) ||
    /403 forbidden/i.test(s)
  ) {
    return new GitError("auth-required", "Authentication required", {
      stderr: s,
      recovery: "reauthenticate",
    });
  }

  // Network / DNS / timeout.
  if (
    /could not resolve host/i.test(s) ||
    /unable to access/i.test(s) ||
    /operation timed out/i.test(s) ||
    /connection timed out/i.test(s) ||
    /network is unreachable/i.test(s)
  ) {
    return new GitError("network-timeout", "Network error contacting remote", {
      stderr: s,
      recovery: "retry",
    });
  }

  // Conflict states — distinguish by op hint when possible.
  // Git's own conflict lines, not the word: a branch or file named
  // `conflict-b` must not turn every failure into a paused merge.
  if (
    /^CONFLICT \(/m.test(s) ||
    /merge conflict in/i.test(s) ||
    /after resolving the conflicts/i.test(s) ||
    /fix conflicts and then commit/i.test(s) ||
    /resolve all conflicts manually/i.test(s)
  ) {
    const op = hint?.op ?? "";
    if (op.includes("rebase")) {
      return new GitError("rebase-conflict", "Rebase paused on conflict", {
        stderr: s,
        recovery: "resolve-conflicts",
      });
    }
    if (op.includes("cherry") || /cherry-pick/i.test(s)) {
      return new GitError(
        "cherry-pick-conflict",
        "Cherry-pick paused on conflict",
        { stderr: s, recovery: "resolve-conflicts" },
      );
    }

    return new GitError("merge-conflict", "Merge paused on conflict", {
      stderr: s,
      recovery: "resolve-conflicts",
    });
  }

  // Dirty working tree blocking the operation.
  if (
    /your local changes .* would be overwritten/i.test(s) ||
    /please commit your changes or stash them/i.test(s) ||
    /you have unstaged changes/i.test(s) ||
    /cannot pull with rebase: you have unstaged changes/i.test(s)
  ) {
    return new GitError(
      "dirty-working-tree",
      "Working tree has uncommitted changes",
      { stderr: s, recovery: "stash-and-retry" },
    );
  }

  // Detached HEAD.
  if (/head is now at/i.test(s) && /detached/i.test(s)) {
    return new GitError("detached-head", "HEAD is detached", { stderr: s });
  }

  // Nothing to commit / push / pull.
  if (
    /nothing to commit/i.test(s) ||
    /no changes added to commit/i.test(s) ||
    /nothing added to commit/i.test(s)
  ) {
    return new GitError("nothing-to-commit", "Nothing to commit", {
      stderr: s,
    });
  }
  if (/everything up-to-date/i.test(s)) {
    return new GitError("nothing-to-push", "Everything up to date", {
      stderr: s,
    });
  }
  if (/already up to date/i.test(s)) {
    return new GitError("nothing-to-pull", "Already up to date", { stderr: s });
  }

  // GPG / SSH signing failure (gpg failed to sign the data, etc.).
  if (
    /gpg failed to sign/i.test(s) ||
    /failed to sign the data/i.test(s) ||
    /secret key not available/i.test(s) ||
    /no signing key/i.test(s) ||
    /signing failed/i.test(s)
  ) {
    return new GitError("signing-failed", "Commit signing failed", {
      stderr: s,
      recovery: "configure-signing",
    });
  }

  // LFS missing.
  if (/git-lfs/i.test(s) && /not installed|not found|smudge/i.test(s)) {
    return new GitError("lfs-missing", "git-lfs is not available", {
      stderr: s,
      recovery: "install-lfs",
    });
  }

  // Pre-commit / pre-push hook failure.
  if (
    /hook .* failed/i.test(s) ||
    /pre-commit hook/i.test(s) ||
    /pre-push hook/i.test(s) ||
    /\.git\/hooks\//i.test(s)
  ) {
    return new GitError("hook-failed", "A git hook failed", {
      stderr: s,
      recovery: "show-hook-output",
    });
  }

  // Fallback.
  return new GitError("unknown", s.trim() || "git command failed", {
    stderr: s,
  });
}
