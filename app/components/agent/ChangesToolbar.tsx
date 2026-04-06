import { useCallback, useState, useEffect, useRef } from "react";
import {
  gitPull,
  gitPush,
  gitFetch,
  gitStash,
  gitStashApply,
  gitStashList,
  listBranches,
} from "../../lib/ipc";
import type { GitStashEntry } from "../../lib/ipc";
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

/* ── Icons ────────────────────────────────────────────────── */

function FetchIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 2a.5.5 0 0 1 .5.5v6.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 9.293V2.5A.5.5 0 0 1 8 2z" />
      <path d="M2 13.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z" />
    </svg>
  );
}

function PullIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a.5.5 0 0 1 .5.5v9.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 .708-.708L7.5 11.293V1.5A.5.5 0 0 1 8 1z" />
    </svg>
  );
}

function PushIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 15a.5.5 0 0 1-.5-.5V4.707L5.354 6.854a.5.5 0 1 1-.708-.708l3-3a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 4.707V14.5A.5.5 0 0 1 8 15z" />
    </svg>
  );
}

function ApplyStashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v1A1.5 1.5 0 0 1 13.5 6h-11A1.5 1.5 0 0 1 1 4.5v-1zM2.5 3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11z" />
      <path d="M8 7.5a.5.5 0 0 1 .5.5v2.793l1.146-1.147a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 .708-.708L7.5 10.793V8a.5.5 0 0 1 .5-.5z" />
    </svg>
  );
}

function SaveStashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v1A1.5 1.5 0 0 1 13.5 6h-11A1.5 1.5 0 0 1 1 4.5v-1zM2.5 3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11z" />
      <path d="M8 12.5a.5.5 0 0 1-.5-.5V9.207L6.354 10.354a.5.5 0 1 1-.708-.708l2-2a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 9.207V12a.5.5 0 0 1-.5.5z" />
    </svg>
  );
}

function SearchIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
    </svg>
  );
}

/* ── Dropdown wrapper ─────────────────────────────────────── */

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

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
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<null | string>(null);

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
          onClick={() => runAction("fetch", () => gitFetch(workspaceId))}
          title="Fetch"
          disabled={busy !== null}
        >
          <FetchIcon />
        </button>

        {/* Pull (dropdown) */}
        <div className={styles.dropdownAnchor} ref={pullDrop.ref}>
          <button
            className={styles.toolbarBtn}
            onClick={openPullDropdown}
            title="Pull"
            disabled={busy !== null}
          >
            <PullIcon />
          </button>
          {pullDrop.open && (
            <div className={styles.dropdown}>
              <div className={styles.dropdownTitle}>Pull from branch</div>
              {loadingBranches ? (
                <div className={styles.dropdownLoading}>Loading...</div>
              ) : branches.length === 0 ? (
                <div className={styles.dropdownEmpty}>No branches</div>
              ) : (
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
                ))
              )}
            </div>
          )}
        </div>

        {/* Push */}
        <button
          className={styles.toolbarBtn}
          onClick={() => runAction("push", () => gitPush(workspaceId))}
          title="Push"
          disabled={busy !== null}
        >
          <PushIcon />
        </button>

        <div className={styles.separator} />

        {/* Apply Stash (dropdown) */}
        <div className={styles.dropdownAnchor} ref={stashDrop.ref}>
          <button
            className={styles.toolbarBtn}
            onClick={openStashDropdown}
            title="Apply Stash"
            disabled={busy !== null}
          >
            <ApplyStashIcon />
          </button>
          {stashDrop.open && (
            <div className={styles.dropdown}>
              <div className={styles.dropdownTitle}>Apply stash</div>
              {loadingStashes ? (
                <div className={styles.dropdownLoading}>Loading...</div>
              ) : stashes.length === 0 ? (
                <div className={styles.dropdownEmpty}>No stashes</div>
              ) : (
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
                ))
              )}
            </div>
          )}
        </div>

        {/* Save Stash */}
        <button
          className={styles.toolbarBtn}
          onClick={() => runAction("stash", () => gitStash(workspaceId))}
          title="Save Stash"
          disabled={busy !== null}
        >
          <SaveStashIcon />
        </button>
      </div>

      {/* Search */}
      <div className={styles.searchBox}>
        <SearchIcon />
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search for File"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {error && <div className={styles.errorToast}>{error}</div>}
    </div>
  );
}
