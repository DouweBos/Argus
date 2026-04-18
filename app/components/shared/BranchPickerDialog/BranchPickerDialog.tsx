import { useEffect, useMemo, useState } from "react";
import { Dialog, Input } from "@argus/peacock";
import { checkoutBranch, listBranches } from "../../../lib/ipc";
import {
  hideBranchPicker,
  useBranchPickerTarget,
} from "../../../stores/branchPickerStore";
import styles from "./BranchPickerDialog.module.css";

export function BranchPickerDialog() {
  const { repoRoot, workspaceId } = useBranchPickerTarget();
  if (!repoRoot || !workspaceId) {
    return null;
  }

  return (
    <BranchPickerDialogContent repoRoot={repoRoot} workspaceId={workspaceId} />
  );
}

function BranchPickerDialogContent({
  repoRoot,
  workspaceId,
}: {
  repoRoot: string;
  workspaceId: string;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listBranches(repoRoot)
      .then((list) => {
        if (!cancelled) {
          setBranches(list);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return branches;
    }

    return branches.filter((b) => b.toLowerCase().includes(q));
  }, [branches, query]);

  const handlePick = async (branch: string) => {
    setCheckingOut(true);
    setError(null);
    try {
      await checkoutBranch(repoRoot, branch);
      hideBranchPicker();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <Dialog
      title="Switch branch"
      titleId="branch-picker-title"
      onClose={hideBranchPicker}
    >
      <div className={styles.body}>
        <Input
          autoFocus
          placeholder="Filter branches…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.list}>
          {loading && <div className={styles.empty}>Loading branches…</div>}
          {!loading && filtered.length === 0 && (
            <div className={styles.empty}>No matching branches.</div>
          )}
          {filtered.map((b) => (
            <button
              key={b}
              className={styles.item}
              disabled={checkingOut}
              type="button"
              onClick={() => {
                handlePick(b).catch(() => {});
              }}
            >
              {b}
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          <span className={styles.caption}>
            Changes the HEAD of this workspace&apos;s worktree.
          </span>
          <span className={styles.caption} data-muted>
            {workspaceId.slice(0, 8)}
          </span>
        </div>
      </div>
    </Dialog>
  );
}
