import type { Session } from "../../../lib/types";
import { useEffect, useState } from "react";
import { Banner, Button, DialogBody, DialogFooter } from "@argus/peacock";
import { getSessionCommitsAhead, getSessionStatus } from "../../../lib/ipc";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

interface DeleteSessionDialogProps {
  onClose: () => void;
  onConfirm: (deleteBranch: boolean) => Promise<void>;
  session: Session;
}

interface PendingWork {
  modified: number;
  staged: number;
  unmergedCommits: number;
  untracked: number;
}

export function DeleteSessionDialog({
  session,
  onClose,
  onConfirm,
}: DeleteSessionDialogProps) {
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingWork | null>(null);

  const displayName = session.display_name ?? session.branch;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statusOutput, ahead] = await Promise.all([
          getSessionStatus(session.id),
          getSessionCommitsAhead(session.id),
        ]);
        if (cancelled) {
          return;
        }
        setPending({
          ...countStatusEntries(statusOutput),
          unmergedCommits: ahead,
        });
      } catch {
        // Best-effort warning — fall back to generic copy on failure.
        if (!cancelled) {
          setPending(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm(deleteBranch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete session");
    } finally {
      setIsDeleting(false);
    }
  };

  const warningParts = pending ? describePending(pending) : [];

  return (
    <Dialog title="Delete Session" titleId="delete-ws-title" onClose={onClose}>
      <DialogBody as="form" id="delete-ws-form" onSubmit={handleSubmit}>
        <p className={styles.bodyText}>
          Are you sure you want to delete <strong>{displayName}</strong>? This
          will remove the worktree and any uncommitted changes.
        </p>

        {warningParts.length > 0 && (
          <Banner tone="warning">
            This session still has work that will be lost:{" "}
            {joinHumanList(warningParts)}.
          </Banner>
        )}

        <label className={styles.checkboxRow}>
          <input
            checked={deleteBranch}
            type="checkbox"
            onChange={(e) => setDeleteBranch(e.target.checked)}
          />
          Also delete branch <code>{session.branch}</code>
        </label>

        {error && <p className={styles.errorMsg}>{error}</p>}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={isDeleting}
          form="delete-ws-form"
          type="submit"
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * Parse `git status --short` output into counts of staged, modified-but-unstaged,
 * and untracked entries. Mirrors the parsing in `getSessionMergeStatus`.
 */
function countStatusEntries(
  raw: string,
): Pick<PendingWork, "modified" | "staged" | "untracked"> {
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  for (const line of raw.split("\n")) {
    if (!line) {
      continue;
    }
    const indexFlag = line.charAt(0);
    const treeFlag = line.charAt(1);
    if (indexFlag === "?" && treeFlag === "?") {
      untracked += 1;
      continue;
    }
    if (indexFlag !== " " && indexFlag !== "?") {
      staged += 1;
    }
    if (treeFlag !== " " && treeFlag !== "?") {
      modified += 1;
    }
  }

  return { modified, staged, untracked };
}

function describePending(p: PendingWork): string[] {
  const parts: string[] = [];
  if (p.unmergedCommits > 0) {
    parts.push(
      plural(p.unmergedCommits, "unmerged commit", "unmerged commits"),
    );
  }
  if (p.staged > 0) {
    parts.push(plural(p.staged, "staged file", "staged files"));
  }
  if (p.modified > 0) {
    parts.push(plural(p.modified, "modified file", "modified files"));
  }
  if (p.untracked > 0) {
    parts.push(plural(p.untracked, "untracked file", "untracked files"));
  }

  return parts;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function joinHumanList(items: string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
