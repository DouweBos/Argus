import type { GitStashEntry } from "../../../lib/ipc";
import { useCallback, useMemo, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import { useGlobalShortcuts } from "../../../hooks/useGlobalShortcuts";
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
import styles from "./ChangesToolbar.module.css";

interface ChangesToolbarProps {
  branchName?: string;
  fileCount: number;
  onRefresh: () => void;
  onSearchChange: (query: string) => void;
  repoRoot: string;
  searchQuery: string;
  sessionId: string;
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
  sessionId,
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
      const s = await gitStashList(sessionId);
      setStashes(s);
    } catch {
      setStashes([]);
    } finally {
      setLoadingStashes(false);
    }
  }, [stashDrop, sessionId]);

  // Tower-style remote and stash shortcuts. Mounted only on the working-copy
  // sub-view, so registration is implicitly gated to the relevant context.
  const shortcuts = useMemo(
    () => [
      // Fetch: Shift+Cmd+F
      {
        key: "f",
        meta: true,
        shift: true,
        handler: () => runAction("fetch", () => gitFetch(sessionId)),
      },
      // Pull (tracked branch, no rebase): Shift+Cmd+P
      {
        key: "p",
        meta: true,
        shift: true,
        handler: () => runAction("pull", () => gitPull(sessionId)),
      },
      // Push: Shift+Cmd+U
      {
        key: "u",
        meta: true,
        shift: true,
        handler: () => runAction("push", () => gitPush(sessionId)),
      },
      // Save stash: Shift+Cmd+S
      {
        key: "s",
        meta: true,
        shift: true,
        handler: () => runAction("stash", () => gitStash(sessionId)),
      },
      // Apply most recent stash: Shift+Opt+Cmd+S
      {
        key: "s",
        meta: true,
        shift: true,
        alt: true,
        handler: async () => {
          try {
            const list = await gitStashList(sessionId);
            if (list.length === 0) {
              return;
            }
            await runAction("stash-apply", () =>
              gitStashApply(sessionId, list[0]!.index),
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        },
      },
    ],
    [runAction, sessionId],
  );
  useGlobalShortcuts(shortcuts);

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
          onClick={() => runAction("fetch", () => gitFetch(sessionId))}
        >
          <Icons.FetchIcon />
        </button>

        {/* Pull (dropdown) */}
        <div ref={pullDrop.ref} className={styles.dropdownAnchor}>
          <button
            className={styles.toolbarBtn}
            disabled={busy !== null}
            title="Pull"
            onClick={openPullDropdown}
          >
            <Icons.PullIcon />
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
                        runAction("pull", () => gitPull(sessionId, b, false));
                      }}
                    >
                      Merge
                    </button>
                    <button
                      className={styles.dropdownAction}
                      onClick={() => {
                        pullDrop.setOpen(false);
                        runAction("pull", () => gitPull(sessionId, b, true));
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
          onClick={() => runAction("push", () => gitPush(sessionId))}
        >
          <Icons.PushIcon />
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
            <Icons.ApplyStashIcon />
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
                        gitStashApply(sessionId, s.index),
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
          onClick={() => runAction("stash", () => gitStash(sessionId))}
        >
          <Icons.SaveStashIcon />
        </button>
      </div>

      {/* Search */}
      <div className={styles.searchBox}>
        <Icons.SearchIcon />
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
