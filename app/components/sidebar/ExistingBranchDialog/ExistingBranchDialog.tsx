import { useEffect, useMemo, useState } from "react";
import { BranchPicker, type BranchPickerEntry } from "@argus/peacock";
import { listAllBranches } from "../../../lib/ipc";
import { createSessionInProject } from "../../../lib/projectsService";
import { selectSession, useSessions } from "../../../stores/sessionStore";

interface ExistingBranchDialogProps {
  onClose: () => void;
  repoRoot: string;
}

/**
 * Open a branch that already exists — local, or only on the remote — in a
 * worktree of its own. Branches another session already holds aren't offered.
 */
export function ExistingBranchDialog({
  onClose,
  repoRoot,
}: ExistingBranchDialogProps) {
  const sessions = useSessions();
  const [list, setList] = useState<{ local: string[]; remote: string[] }>({
    local: [],
    remote: [],
  });

  useEffect(() => {
    let cancelled = false;
    listAllBranches(repoRoot)
      .then((result) => !cancelled && setList(result))
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [repoRoot]);

  const [local, remote] = useMemo(() => {
    const claimed = new Set(
      sessions
        .filter((s) => s.repo_root === repoRoot && s.kind === "worktree")
        .map((s) => s.branch),
    );
    const entries = (names: string[], prefix: string): BranchPickerEntry[] =>
      names
        .filter((name) => !claimed.has(name))
        .map((name) => ({
          id: name,
          name: `${prefix}${name}`,
          remote: prefix ? "origin" : undefined,
        }));

    return [entries(list.local, ""), entries(list.remote, "origin/")];
  }, [list, repoRoot, sessions]);

  const open = async (entry: BranchPickerEntry) => {
    onClose();
    try {
      const session = await createSessionInProject(
        repoRoot,
        entry.id,
        "",
        true,
      );
      selectSession(session.id, "home");
    } catch {
      // createSessionInProject already reported it.
    }
  };

  return (
    <BranchPicker
      open
      branches={local}
      remoteBranches={remote}
      title="Open an existing branch"
      confirmLabel="Open in worktree"
      emptyLabel="No free branches match"
      onCancel={onClose}
      onSelect={open}
    />
  );
}
