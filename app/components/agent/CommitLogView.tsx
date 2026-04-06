import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { gitLog, gitShowCommit } from "../../lib/ipc";
import type { GitCommit } from "../../lib/ipc";
import { md5Hex } from "../../lib/md5";
import { ResizablePanel } from "../layout/ResizablePanel";
import { parseDiff } from "../../lib/diffParser";
import type { DiffFile } from "../../lib/diffParser";
import { FileDiffView } from "./FileDiffView";
import { FileIcon, ChevronRightIcon, ChevronDownIcon } from "../shared/Icons";
import { buildGraphLanes } from "../../lib/gitGraph";
import { GraphCell } from "./GraphCell";
import styles from "./HistoryView.module.css";

const ROW_HEIGHT = 42;
const PAGE_SIZE = 100;

interface CommitLogViewProps {
  allBranches: boolean;
  showGraph?: boolean;
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

function authorInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
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

export function CommitLogView({
  workspaceId,
  allBranches,
  showGraph = true,
}: CommitLogViewProps) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<null | string>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [prevDeps, setPrevDeps] = useState({ allBranches, workspaceId });

  // Reset state when workspace or branch filter changes
  if (
    workspaceId !== prevDeps.workspaceId ||
    allBranches !== prevDeps.allBranches
  ) {
    setPrevDeps({ allBranches, workspaceId });
    setCommits([]);
    setIsLoading(true);
    setError(null);
    setHasMore(true);
    setSelectedIdx(-1);
  }

  // Initial load
  useEffect(() => {
    gitLog(workspaceId, PAGE_SIZE, allBranches)
      .then((c) => {
        setCommits(c);
        setHasMore(c.length >= PAGE_SIZE);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      });
  }, [workspaceId, allBranches]);

  // Load more when sentinel becomes visible
  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    // Fetch next page by requesting PAGE_SIZE more than current total,
    // then slice off what we already have
    const nextCount = commits.length + PAGE_SIZE;
    gitLog(workspaceId, nextCount, allBranches)
      .then((c) => {
        setHasMore(c.length >= nextCount);
        setCommits(c);
        setIsLoadingMore(false);
      })
      .catch(() => {
        setIsLoadingMore(false);
      });
  }, [workspaceId, allBranches, commits.length, isLoadingMore, hasMore]);

  // IntersectionObserver on sentinel
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const list = listRef.current;
    if (!sentinel || !list) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { root: list, rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const selectCommit = useCallback(
    async (idx: number) => {
      setSelectedIdx(idx);
      setExpandedFiles(new Set());
      setDiffFiles([]);
      const commit = commits[idx];
      if (!commit) return;
      try {
        const diff = await gitShowCommit(workspaceId, commit.hash);
        setDiffFiles(diff ? parseDiff(diff) : []);
      } catch {
        setDiffFiles([]);
      }
    },
    [commits, workspaceId],
  );

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
    for (let i = 0; i < diffFiles.length; i++) all.add(i);
    setExpandedFiles(all);
  }, [diffFiles.length]);

  const graphRows = useMemo(
    () => (showGraph ? buildGraphLanes(commits) : []),
    [commits, showGraph],
  );

  const selected = selectedIdx >= 0 ? commits[selectedIdx] : null;

  const authorEmail = selected?.authorEmail ?? null;
  const gravatarUrl = useMemo(() => {
    if (!authorEmail) return null;
    const hash = authorEmail.trim().toLowerCase();
    return `https://www.gravatar.com/avatar/${md5Hex(hash)}?s=80&d=identicon`;
  }, [authorEmail]);

  let totalAdds = 0;
  let totalDels = 0;
  for (const f of diffFiles) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.type === "add") totalAdds++;
        else if (l.type === "remove") totalDels++;
      }
    }
  }

  if (isLoading) {
    return <div className={styles.emptyState}>Loading commits...</div>;
  }

  if (error) {
    return (
      <div className={styles.emptyState} style={{ color: "var(--error)" }}>
        {error}
      </div>
    );
  }

  return (
    <>
      <ResizablePanel
        defaultWidth={0.4}
        minWidth={0.2}
        maxWidth={0.6}
        side="left"
      >
        <div className={styles.commitList} ref={listRef}>
          {commits.map((commit, i) => (
            <button
              key={commit.hash}
              className={`${styles.commitItem} ${i === selectedIdx ? styles.commitItemActive : ""}`}
              onClick={() => selectCommit(i)}
            >
              {showGraph && graphRows[i] && (
                <GraphCell row={graphRows[i]} rowHeight={ROW_HEIGHT} />
              )}
              <div className={styles.commitAvatar}>
                {authorInitials(commit.author)}
              </div>
              <div className={styles.commitInfo}>
                <div className={styles.commitTop}>
                  <span className={styles.commitAuthor}>{commit.author}</span>
                  {commit.refs && (
                    <span className={styles.commitRefs}>
                      {commit.refs.split(",").map((ref) => (
                        <span key={ref.trim()} className={styles.refBadge}>
                          {ref.trim()}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <div className={styles.commitSubject}>
                  <span className={styles.commitHash}>
                    {commit.abbreviatedHash}
                  </span>{" "}
                  {commit.subject}
                </div>
              </div>
              <span className={styles.commitDate}>
                {formatDate(commit.date)}
              </span>
            </button>
          ))}
          {hasMore && (
            <div ref={sentinelRef} className={styles.loadingMore}>
              {isLoadingMore ? "Loading more..." : ""}
            </div>
          )}
          {commits.length === 0 && (
            <div className={styles.emptyState}>No commits</div>
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
                    <span className={styles.metaLabel}>Author Date</span>
                    <span className={styles.metaValue}>{selected.date}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Committer</span>
                    <span className={styles.metaValue}>
                      {selected.committer} &lt;{selected.committerEmail}&gt;
                    </span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Committer Date</span>
                    <span className={styles.metaValue}>
                      {selected.committerDate}
                    </span>
                  </div>
                  {selected.refs && (
                    <div className={styles.metaRow}>
                      <span className={styles.metaLabel}>Refs</span>
                      <span className={styles.metaValue}>
                        {selected.refs.split(",").map((r) => (
                          <span key={r.trim()} className={styles.metaRefBadge}>
                            {r.trim()}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
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
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Tree Hash</span>
                    <span className={styles.metaValue}>
                      {selected.treeHash}
                    </span>
                  </div>
                </div>
                {gravatarUrl && (
                  <img
                    className={styles.detailAvatar}
                    src={gravatarUrl}
                    alt={selected.author}
                    width={48}
                    height={48}
                  />
                )}
              </div>
              <div className={styles.detailMessage}>{selected.subject}</div>
            </div>

            <div className={styles.filesHeader}>
              <button className={styles.expandAllBtn} onClick={expandAll}>
                Expand All
              </button>
              <span className={styles.filesStats}>
                Showing {diffFiles.length} changed file
                {diffFiles.length !== 1 ? "s" : ""} with{" "}
                <span className={styles.statAdd}>
                  {totalAdds} addition{totalAdds !== 1 ? "s" : ""}
                </span>
                {" and "}
                <span className={styles.statDel}>
                  {totalDels} deletion{totalDels !== 1 ? "s" : ""}
                </span>
              </span>
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
                          <ChevronDownIcon size={10} />
                        ) : (
                          <ChevronRightIcon size={8} />
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
                          workspaceId={workspaceId}
                          onAction={async () => {}}
                          inline
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
            <FileIcon size={48} />
            <p>Select a commit to view details</p>
          </div>
        )}
      </div>
    </>
  );
}
