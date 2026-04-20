import type { DiffFile } from "../../../lib/diffParser";
import type { GitStashEntry } from "../../../lib/ipc";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, DiffStat, Icons } from "@argus/peacock";
import { parseDiff } from "../../../lib/diffParser";
import {
  gitStashApply,
  gitStashDrop,
  gitStashList,
  gitStashShow,
} from "../../../lib/ipc";
import { md5Hex } from "../../../lib/md5";
import { ResizablePanel } from "../../layout/ResizablePanel";
import { FileDiffView } from "../FileDiffView";
import styles from "./StashesView.module.css";

interface StashesViewProps {
  onRefresh: () => void;
  workspaceId: string;
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

function statusLabel(status: string): string {
  switch (status) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "M":
      return "modified";
    case "R":
      return "renamed";
    default:
      return status;
  }
}

export function StashesView({ workspaceId, onRefresh }: StashesViewProps) {
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [expandedFiles, setExpandedFiles] = useState(() => new Set());
  const [applying, setApplying] = useState(false);

  const fetchStashes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await gitStashList(workspaceId);
      setStashes(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

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
        const diff = await gitStashShow(workspaceId, stash.index);
        setDiffFiles(diff ? parseDiff(diff) : []);
      } catch {
        setDiffFiles([]);
      }
    },
    [stashes, workspaceId],
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
    setError(null);
    try {
      await gitStashApply(workspaceId, stash.index);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [workspaceId, stashes, selectedIdx, onRefresh]);

  const handleDelete = useCallback(async () => {
    const stash = stashes[selectedIdx];
    if (!stash) {
      return;
    }
    setApplying(true);
    setError(null);
    try {
      await gitStashDrop(workspaceId, stash.index);
      setSelectedIdx(-1);
      setDiffFiles([]);
      await fetchStashes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [workspaceId, stashes, selectedIdx, fetchStashes]);

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

  // Count additions and deletions
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
        <div className={styles.emptyState}>Loading stashes...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState} style={{ color: "var(--error)" }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
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
              <span className={styles.stashDate}>{formatDate(stash.date)}</span>
            </button>
          ))}
          {stashes.length === 0 && (
            <div className={styles.emptyState}>No stashes</div>
          )}
        </div>
      </ResizablePanel>

      <div className={styles.detailPanel}>
        {selected ? (
          <div className={styles.detailContent}>
            <div className={styles.detailHeader}>
              <div className={styles.detailHeaderRow}>
                <div className={styles.detailMeta}>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Author</span>
                    <span className={styles.metaValue}>
                      {selected.author} &lt;{selected.authorEmail}&gt;
                    </span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Date</span>
                    <span className={styles.metaValue}>{selected.date}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Commit Hash</span>
                    <span className={styles.metaValue}>{selected.hash}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Parent Hash</span>
                    <span className={styles.metaValue}>
                      {selected.parentHash}
                    </span>
                  </div>
                </div>
                {gravatarUrl && (
                  <img
                    alt={selected.author}
                    className={styles.detailAvatar}
                    height={48}
                    src={gravatarUrl}
                    width={48}
                  />
                )}
              </div>
              <div className={styles.detailMessage}>{selected.message}</div>
              <div className={styles.detailActions}>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={applying}
                  onClick={handleApply}
                >
                  {applying ? "Applying..." : "Apply"}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={applying}
                  onClick={handleDelete}
                >
                  Delete
                </Button>
              </div>
            </div>

            <div className={styles.filesHeader}>
              <Button size="sm" variant="ghost" onClick={expandAll}>
                Expand All
              </Button>
              <span className={styles.filesStats}>
                {diffFiles.length} changed file
                {diffFiles.length !== 1 ? "s" : ""}
              </span>
              <DiffStat added={totalAdds} removed={totalDels} />
            </div>

            <div className={styles.filesList}>
              {diffFiles.map((file, i) => {
                const path = file.newPath || file.oldPath;
                const isExpanded = expandedFiles.has(i);

                return (
                  <div key={`${path}-${i}`}>
                    <button
                      className={`${styles.fileRow} ${isExpanded ? styles.fileRowExpanded : ""}`}
                      onClick={() => toggleFile(i)}
                    >
                      <span className={styles.fileChevron}>
                        {isExpanded ? (
                          <Icons.ChevronDownIcon size={10} />
                        ) : (
                          <Icons.ChevronRightIcon size={8} />
                        )}
                      </span>
                      <span className={styles.fileStatusLabel}>
                        {statusLabel(file.status)}
                      </span>
                      <span
                        className={`${styles.fileBadge} ${styles[`badge${file.status}`]}`}
                      >
                        {file.status}
                      </span>
                      <span className={styles.filePath}>{path}</span>
                    </button>
                    {isExpanded && (
                      <div className={styles.fileDiffInline}>
                        <FileDiffView
                          file={file}
                          inline
                          workspaceId={workspaceId}
                          onAction={async () => {}}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <Icons.FileIcon size={48} />
            <p>Select a stash to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}
