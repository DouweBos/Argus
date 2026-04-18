import type { GitStashEntry } from "../../../lib/ipc";
import { useCallback, useRef, useState } from "react";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import {
  gitFetch,
  gitPull,
  gitPush,
  gitStash,
  gitStashApply,
  gitStashList,
  listBranches,
} from "../../../lib/ipc";
import {
  ApplyStashIcon,
  FetchIcon,
  PullIcon,
  PushIcon,
  SaveStashIcon,
  SearchIcon,
} from "../../shared/Icons";
import styles from "./ChangesToolbar.module.css";

interface ChangesToolbarProps {
  branchName?: string;
  fileCount: number;
  onRefresh: () => void;
  onSearchChange: (query: string) => void;
  repoRoot: string;
  searchQuery: string;
  workspaceId: string;
}

/* ── Dropdown wrapper ─────────────────────────────────────── */

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, open, () => setOpen(false));

  return { open, setOpen, ref };
}

/* ── Main component ───────────────────────────────────────── */

export function ChangesToolbar({
  branchName,
  fileCount,
  workspaceId,
  repoRoot,
  onRefresh,
  searchQuery,
  onSearchChange,
}: ChangesToolbarProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pull dropdown state
  const pullDrop = useDropdown();
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Stash dropdown state
  const stashDrop = useDropdown();
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [loadingStashes, setLoadingStashes] = useState(false);

  const runAction = useCallback(
    async (name: string, action: () => Promise<unknown>) => {
      setBusy(name);
      setError(null);
      try {
        await action();
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [onRefresh],
  );

  const openPullDropdown = useCallback(async () => {
    if (pullDrop.open) {
      pullDrop.setOpen(false);

      return;
    }

    pullDrop.setOpen(true);
    setLoadingBranches(true);
    try {
      const b = await listBranches(repoRoot);
      setBranches(b);
    } catch {
      setBranches([]);
    } finally {
      setLoadingBranches(false);
    }
  }, [pullDrop, repoRoot]);

  const openStashDropdown = useCallback(async () => {
    if (stashDrop.open) {
      stashDrop.setOpen(false);

      return;
    }

    stashDrop.setOpen(true);
    setLoadingStashes(true);
    try {
      const s = await gitStashList(workspaceId);
      setStashes(s);
    } catch {
      setStashes([]);
    } finally {
      setLoadingStashes(false);
    }
  }, [stashDrop, workspaceId]);

  const subtitle = `Working Copy (${branchName ?? "unknown"} – ${fileCount} Changed File${fileCount !== 1 ? "s" : ""})`;

  return (
    <div className={styles.headerBar}>
      <div className={styles.titleArea}>
        <span className={styles.subtitle}>{subtitle}</span>
      </div>

      <div className={styles.actions}>
        {/* Fetch */}
        <button
          className={styles.toolbarBtn}
          disabled={busy !== null}
          title="Fetch"
          onClick={() => runAction("fetch", () => gitFetch(workspaceId))}
        >
          <FetchIcon />
        </button>

        {/* Pull (dropdown) */}
        <div ref={pullDrop.ref} className={styles.dropdownAnchor}>
          <button
            className={styles.toolbarBtn}
            disabled={busy !== null}
            title="Pull"
            onClick={openPullDropdown}
          >
            <PullIcon />
          </button>
          {pullDrop.open && (
            <div className={styles.dropdown}>
              <div className={styles.dropdownTitle}>Pull from branch</div>
              {loadingBranches && (
                <div className={styles.dropdownLoading}>Loading...</div>
              )}
              {!loadingBranches && branches.length === 0 && (
                <div className={styles.dropdownEmpty}>No branches</div>
              )}
              {!loadingBranches &&
                branches.length > 0 &&
                branches.map((b) => (
                  <div key={b} className={styles.dropdownBranchRow}>
                    <span className={styles.dropdownBranchName}>{b}</span>
                    <button
                      className={styles.dropdownAction}
                      onClick={() => {
                        pullDrop.setOpen(false);
                        runAction("pull", () => gitPull(workspaceId, b, false));
                      }}
                    >
                      Merge
                    </button>
                    <button
                      className={styles.dropdownAction}
                      onClick={() => {
                        pullDrop.setOpen(false);
                        runAction("pull", () => gitPull(workspaceId, b, true));
                      }}
                    >
                      Rebase
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Push */}
        <button
          className={styles.toolbarBtn}
          disabled={busy !== null}
          title="Push"
          onClick={() => runAction("push", () => gitPush(workspaceId))}
        >
          <PushIcon />
        </button>

        <div className={styles.separator} />

        {/* Apply Stash (dropdown) */}
        <div ref={stashDrop.ref} className={styles.dropdownAnchor}>
          <button
            className={styles.toolbarBtn}
            disabled={busy !== null}
            title="Apply Stash"
            onClick={openStashDropdown}
          >
            <ApplyStashIcon />
          </button>
          {stashDrop.open && (
            <div className={styles.dropdown}>
              <div className={styles.dropdownTitle}>Apply stash</div>
              {loadingStashes && (
                <div className={styles.dropdownLoading}>Loading...</div>
              )}
              {!loadingStashes && stashes.length === 0 && (
                <div className={styles.dropdownEmpty}>No stashes</div>
              )}
              {!loadingStashes &&
                stashes.length > 0 &&
                stashes.map((s) => (
                  <button
                    key={s.hash}
                    className={styles.dropdownItem}
                    onClick={() => {
                      stashDrop.setOpen(false);
                      runAction("stash-apply", () =>
                        gitStashApply(workspaceId, s.index),
                      );
                    }}
                  >
                    {s.message}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Save Stash */}
        <button
          className={styles.toolbarBtn}
          disabled={busy !== null}
          title="Save Stash"
          onClick={() => runAction("stash", () => gitStash(workspaceId))}
        >
          <SaveStashIcon />
        </button>
      </div>

      {/* Search */}
      <div className={styles.searchBox}>
        <SearchIcon />
        <input
          className={styles.searchInput}
          placeholder="Search for File"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {error && <div className={styles.errorToast}>{error}</div>}
    </div>
  );
}
