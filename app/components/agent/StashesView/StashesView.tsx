import type { DiffFile } from "../../../lib/diffParser";
import type { GitStashEntry } from "../../../lib/ipc";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DestructiveConfirm,
  GitErrorBanner,
  GitSkeleton,
  Icons,
  type GitErrorKind,
} from "@argus/peacock";
import { ResizablePanel } from "@argus/peacock";
import { parseDiff } from "../../../lib/diffParser";
import { GitError } from "../../../lib/gitError";
import {
  gitStashApply,
  gitStashBranch,
  gitStashDrop,
  gitStashList,
  gitStashPop,
  gitStashShow,
} from "../../../lib/ipc";
import { md5Hex } from "../../../lib/md5";
import {
  getConfirmPreference,
  setConfirmPreference,
} from "../../../stores/settingsStore";
import { ViewHeader } from "../GitView/ViewHeader";
import { StashDetailPanel, type StashDetailTab } from "./StashDetailPanel";
import styles from "./StashesView.module.css";

interface StashesViewProps {
  onRefresh: () => void;
  sessionId: string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);

    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function StashesView({ sessionId, onRefresh }: StashesViewProps) {
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [banner, setBanner] = useState<{
    kind: GitErrorKind;
    message: string;
    recovery?: string;
  } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(
    () => new Set(),
  );
  const [applying, setApplying] = useState(false);
  const [dropConfirmOpen, setDropConfirmOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<StashDetailTab>("files");
  const [toast, setToast] = useState<string | null>(null);

  const captureError = (err: unknown) => {
    if (err instanceof GitError) {
      setBanner({
        kind: err.kind,
        message: err.message,
        recovery: err.recovery,
      });
    } else {
      setBanner({
        kind: "unknown",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const fetchStashes = useCallback(async () => {
    setIsLoading(true);
    setBanner(null);
    try {
      const list = await gitStashList(sessionId);
      setStashes(list);
    } catch (err) {
      captureError(err);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchStashes();
  }, [fetchStashes]);

  const selectStash = useCallback(
    async (idx: number) => {
      setSelectedIdx(idx);
      setExpandedFiles(new Set());
      setDiffFiles([]);
      const stash = stashes[idx];
      if (!stash) {
        return;
      }
      try {
        const diff = await gitStashShow(sessionId, stash.index);
        setDiffFiles(diff ? parseDiff(diff) : []);
      } catch (err) {
        setDiffFiles([]);
        captureError(err);
      }
    },
    [stashes, sessionId],
  );

  const selected = selectedIdx >= 0 ? stashes[selectedIdx] : null;

  const gravatarUrl = useMemo(() => {
    if (!selected?.authorEmail) {
      return null;
    }
    const hash = selected.authorEmail.trim().toLowerCase();

    return `https://www.gravatar.com/avatar/${md5Hex(hash)}?s=80&d=identicon`;
  }, [selected?.authorEmail]);

  const handleApply = useCallback(async () => {
    const stash = stashes[selectedIdx];
    if (!stash) {
      return;
    }
    setApplying(true);
    setBanner(null);
    try {
      await gitStashApply(sessionId, stash.index);
      onRefresh();
    } catch (err) {
      captureError(err);
    } finally {
      setApplying(false);
    }
  }, [sessionId, stashes, selectedIdx, onRefresh]);

  const handlePop = useCallback(async () => {
    const stash = stashes[selectedIdx];
    if (!stash) {
      return;
    }
    setApplying(true);
    setBanner(null);
    try {
      // `git stash pop` always pops the most recent stash. Surface a hint
      // when the user picked a different one.
      if (stash.index !== 0) {
        setBanner({
          kind: "unknown",
          message:
            "Pop always operates on the latest stash. Apply + Drop the selected entry instead.",
        });
        setApplying(false);

        return;
      }
      await gitStashPop(sessionId);
      setSelectedIdx(-1);
      setDiffFiles([]);
      await fetchStashes();
      onRefresh();
    } catch (err) {
      captureError(err);
    } finally {
      setApplying(false);
    }
  }, [sessionId, stashes, selectedIdx, fetchStashes, onRefresh]);

  const handleCreateBranch = useCallback(
    async (branchName: string) => {
      const stash = stashes[selectedIdx];
      if (!stash) {
        return;
      }
      setApplying(true);
      setBanner(null);
      try {
        await gitStashBranch(sessionId, `stash@{${stash.index}}`, branchName);
        setToast(`Created branch ${branchName} from stash`);
        setSelectedIdx(-1);
        setDiffFiles([]);
        await fetchStashes();
        onRefresh();
      } catch (err) {
        captureError(err);
      } finally {
        setApplying(false);
      }
    },
    [sessionId, stashes, selectedIdx, fetchStashes, onRefresh],
  );

  const handleDelete = useCallback(async () => {
    const stash = stashes[selectedIdx];
    if (!stash) {
      return;
    }
    setDropConfirmOpen(false);
    setApplying(true);
    setBanner(null);
    try {
      await gitStashDrop(sessionId, stash.index);
      setSelectedIdx(-1);
      setDiffFiles([]);
      await fetchStashes();
    } catch (err) {
      captureError(err);
    } finally {
      setApplying(false);
    }
  }, [sessionId, stashes, selectedIdx, fetchStashes]);

  const toggleFile = useCallback((i: number) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }

      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<number>();
    for (let i = 0; i < diffFiles.length; i++) {
      all.add(i);
    }
    setExpandedFiles(all);
  }, [diffFiles.length]);

  let totalAdds = 0;
  let totalDels = 0;
  for (const f of diffFiles) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.type === "add") {
          totalAdds++;
        } else if (l.type === "remove") {
          totalDels++;
        }
      }
    }
  }

  if (isLoading) {
    return (
      <div className={styles.container}>
        <GitSkeleton variant="stash-list" />
      </div>
    );
  }

  return (
    <div className={styles.outer}>
      <ViewHeader title={`Stashes (${stashes.length})`} />
      <div className={styles.container}>
        {banner && (
          <GitErrorBanner
            kind={banner.kind}
            message={banner.message}
            recovery={banner.recovery}
            onDismiss={() => setBanner(null)}
            onAction={(actionId) => {
              if (actionId === "retry") {
                fetchStashes();

                return;
              }
              if (actionId === "copy-stderr") {
                navigator.clipboard
                  ?.writeText(banner.message)
                  .catch(() => undefined);

                return;
              }
              // eslint-disable-next-line no-console
              console.warn(`[git] action "${actionId}" not wired in Phase 1`);
            }}
          />
        )}
        <DestructiveConfirm
          open={dropConfirmOpen}
          title="Drop stash?"
          description="This permanently removes the stash. This cannot be undone."
          confirmLabel="Drop stash"
          rememberKey="stash-drop"
          rememberLabel="dropping stashes"
          onCancel={() => setDropConfirmOpen(false)}
          onConfirm={(skipNextTime) => {
            if (skipNextTime) {
              setConfirmPreference("stash-drop", true);
            }
            handleDelete();
          }}
        />
        <ResizablePanel
          defaultWidth={0.4}
          maxWidth={0.6}
          minWidth={0.2}
          side="left"
        >
          <div className={styles.stashList}>
            <div className={styles.stashListHeader}>
              Stashes
              {stashes.length > 0 && (
                <span className={styles.stashCount}>({stashes.length})</span>
              )}
            </div>
            {stashes.map((stash, i) => (
              <button
                key={stash.hash}
                className={`${styles.stashItem} ${i === selectedIdx ? styles.stashItemActive : ""}`}
                onClick={() => selectStash(i)}
              >
                <div className={styles.stashInfo}>
                  <div className={styles.stashMessage}>{stash.message}</div>
                </div>
                <span className={styles.stashDate}>
                  {formatDate(stash.date)}
                </span>
              </button>
            ))}
            {stashes.length === 0 && (
              <div className={styles.emptyState}>No stashes</div>
            )}
          </div>
        </ResizablePanel>

        <div className={styles.detailPanel}>
          {selected ? (
            <StashDetailPanel
              applying={applying}
              activeTab={activeTab}
              diffFiles={diffFiles}
              expandedFiles={expandedFiles}
              gravatarUrl={gravatarUrl}
              onApply={handleApply}
              onCreateBranch={handleCreateBranch}
              onDrop={() => {
                if (getConfirmPreference("stash-drop")) {
                  handleDelete();
                } else {
                  setDropConfirmOpen(true);
                }
              }}
              onExpandAll={expandAll}
              onPop={handlePop}
              onTabChange={setActiveTab}
              onToggleFile={toggleFile}
              onToastDismiss={() => setToast(null)}
              selected={selected}
              sessionId={sessionId}
              toast={toast}
              totalAdds={totalAdds}
              totalDels={totalDels}
            />
          ) : (
            <div className={styles.emptyState}>
              <Icons.FileIcon size={48} />
              <p>Select a stash to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
