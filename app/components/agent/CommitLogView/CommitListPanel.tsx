import type {
  CommitLogOperationsActions,
  CommitLogOperationsState,
} from "./useCommitLogOperations";
import type { HistoryFilters as HistoryFiltersValue } from "../../../stores/gitUiStore";
import type { GraphRow, RefBadgeListItem } from "@argus/peacock";
import type { RefObject } from "react";
import {
  Avatar,
  Button,
  CalloutCard,
  Icons,
  RefBadge,
  RefBadgeList,
} from "@argus/peacock";
import { ResizablePanel } from "@argus/peacock";
import { GitError } from "../../../lib/gitError";
import { gitCreateTag, type GitCommit } from "../../../lib/ipc";
import { gravatarUrl as buildGravatarUrl } from "../../../lib/md5";
import { GraphCell } from "../GraphCell";
import styles from "../HistoryView/HistoryView.module.css";
import { CommitRow } from "./CommitRow";
import { HistoryFilters } from "./HistoryFilters";
import {
  classifyRef,
  formatShortDate,
  formatTime,
  refDisplayName,
} from "./utils";

const ROW_HEIGHT = 42;

interface CommitMenuState {
  commitIndex: number;
  x: number;
  y: number;
}

interface CommitListPanelProps {
  aheadSet: Set<string>;
  allBranches: boolean;
  autosquashDismissed: string | null;
  behindSet: Set<string>;
  commits: GitCommit[];
  filters: HistoryFiltersValue;
  filtersOpen: boolean;
  graphRows: GraphRow[];
  handleCommitClick: (e: React.MouseEvent, i: number) => void;
  handleCommitMouseDown: (e: React.MouseEvent) => void;
  hasMore: boolean;
  headHashes: Set<string>;
  isOtherCommitOnHead: (hash: string) => boolean;
  listRef: RefObject<HTMLDivElement | null>;
  loadingMore: boolean;
  onFiltersChange: (next: HistoryFiltersValue) => void;
  ops: CommitLogOperationsActions & CommitLogOperationsState;
  refScopeLabel: string;
  selectCommit: (idx: number) => Promise<void> | void;
  selectedIdx: number;
  sentinelRef: RefObject<HTMLDivElement | null>;
  sessionId: string;
  setAutosquashDismissed: (sig: string | null) => void;
  setContextMenu: (state: CommitMenuState | null) => void;
  setFiltersOpen: (open: (prev: boolean) => boolean) => void;
  showGraph: boolean;
  visibleSelectedHashes: Set<string>;
}

export function CommitListPanel({
  aheadSet,
  allBranches,
  autosquashDismissed,
  behindSet,
  commits,
  filtersOpen,
  filters,
  graphRows,
  handleCommitClick,
  handleCommitMouseDown,
  hasMore,
  headHashes,
  isOtherCommitOnHead,
  listRef,
  loadingMore,
  onFiltersChange,
  ops,
  refScopeLabel,
  selectCommit,
  selectedIdx,
  sentinelRef,
  sessionId,
  setAutosquashDismissed,
  setContextMenu,
  setFiltersOpen,
  showGraph,
  visibleSelectedHashes,
}: CommitListPanelProps) {
  const showAutosquash =
    ops.autosquash !== null && autosquashDismissed !== ops.autosquashSignature;

  const filtersBar = filtersOpen ? (
    <HistoryFilters
      authors={Array.from(new Set(commits.map((c) => c.author))).sort()}
      branches={Array.from(
        new Set(
          commits.flatMap((c) =>
            c.refs ? c.refs.split(",").map((r) => refDisplayName(r)) : [],
          ),
        ),
      ).sort()}
      hideBranch={!allBranches}
      value={filters}
      onChange={onFiltersChange}
    />
  ) : null;

  return (
    <ResizablePanel
      defaultWidth={0.4}
      maxWidth={0.6}
      minWidth={0.2}
      side="left"
    >
      <div className={styles.commitListWrap}>
        {showAutosquash && ops.autosquash && (
          <div className={styles.autosquashBannerWrap}>
            <CalloutCard
              tone="warning"
              leading={<Icons.DownloadIcon size={16} />}
              title="Autosquash Commits"
              meta={
                ops.autosquash.count === 1
                  ? "Found 1 fixup/squash commit that can be automatically combined with its target commit."
                  : `Found ${ops.autosquash.count} fixup/squash commits that can be automatically combined with their target commits.`
              }
              actions={
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={ops.handleAutosquash}
                    disabled={ops.autosquashRunning}
                  >
                    {ops.autosquashRunning ? "Autosquashing…" : "Autosquash…"}
                  </Button>
                  <button
                    type="button"
                    className={styles.autosquashDismiss}
                    aria-label="Dismiss autosquash banner"
                    onClick={() =>
                      setAutosquashDismissed(ops.autosquashSignature)
                    }
                  >
                    <Icons.CloseIcon size={12} />
                  </button>
                </>
              }
            />
          </div>
        )}
        <div className={styles.historyToolbar}>
          <span className={styles.historyScopeLabel}>
            <Icons.BranchIcon size={11} />
            <span>{refScopeLabel}</span>
          </span>
          <button
            type="button"
            className={styles.historyFilterButton}
            aria-label="Toggle history filters"
            aria-pressed={filtersOpen}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <Icons.SlidersIcon size={12} />
          </button>
          <span className={styles.historyToolbarSpacer} />
          <span className={styles.historyCount}>
            {commits.length.toLocaleString()} commit
            {commits.length !== 1 ? "s" : ""}
          </span>
        </div>
        {filtersBar}
        <div ref={listRef} className={styles.commitList}>
          {commits.map((commit, i) => {
            return (
              <CommitRow
                key={commit.hash}
                commit={commit}
                isActive={i === selectedIdx}
                isSelected={visibleSelectedHashes.has(commit.hash)}
                isOnHead={headHashes.has(commit.hash)}
                isOtherCommitOnHead={isOtherCommitOnHead}
                onReorderDropAbove={(sourceHash) => {
                  const source = commits.find((c) => c.hash === sourceHash);
                  if (!source) {
                    return;
                  }
                  ops.setReorderConfirm({
                    source,
                    target: commit,
                    position: "above",
                  });
                }}
                onReorderDropBelow={(sourceHash) => {
                  const source = commits.find((c) => c.hash === sourceHash);
                  if (!source) {
                    return;
                  }
                  ops.setReorderConfirm({
                    source,
                    target: commit,
                    position: "below",
                  });
                }}
                onMouseDown={handleCommitMouseDown}
                onClick={(e) => handleCommitClick(e, i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!visibleSelectedHashes.has(commit.hash)) {
                    selectCommit(i);
                  }
                  setContextMenu({
                    commitIndex: i,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                onTagDrop={(tagName) => {
                  gitCreateTag(sessionId, {
                    name: tagName,
                    ref: commit.hash,
                    force: true,
                  }).catch((err: unknown) => {
                    if (err instanceof GitError) {
                      ops.setOpBanner({
                        kind: err.kind,
                        message: err.message,
                      });
                    }
                  });
                }}
              >
                {showGraph && graphRows[i] && (
                  <GraphCell row={graphRows[i]} rowHeight={ROW_HEIGHT} />
                )}
                <Avatar
                  className={styles.commitAvatar}
                  name={commit.author}
                  src={buildGravatarUrl(commit.authorEmail, 48)}
                />
                <div className={styles.commitInfo}>
                  <div className={styles.commitTop}>
                    <span className={styles.commitSubject}>
                      {commit.subject}
                    </span>
                    {commit.refs &&
                      (() => {
                        const items: RefBadgeListItem[] = commit.refs
                          .split(",")
                          .map((raw) => raw.trim())
                          .filter((r) => r.length > 0)
                          .map((r) => {
                            const type = classifyRef(r);

                            return {
                              name: refDisplayName(r),
                              type,
                              current: type === "head",
                            };
                          });

                        const SHORT_REF_LEN = 18;
                        if (
                          items.length === 1 &&
                          items[0]!.name.length <= SHORT_REF_LEN
                        ) {
                          const only = items[0]!;

                          return (
                            <RefBadge
                              name={only.name}
                              type={only.type}
                              size="sm"
                              current={only.current}
                            />
                          );
                        }

                        return <RefBadgeList items={items} />;
                      })()}
                  </div>
                  <div className={styles.commitSubtitle}>
                    <span className={styles.commitAuthor}>{commit.author}</span>
                    <span className={styles.commitDot}>·</span>
                    <span className={styles.commitTime}>
                      {formatTime(commit.date)}
                    </span>
                  </div>
                </div>
                <span className={styles.commitHash}>
                  {formatShortDate(commit.date)}
                </span>
                {(() => {
                  if (aheadSet.has(commit.hash)) {
                    return (
                      <span
                        className={styles.commitSyncIndicator}
                        title="Ahead of upstream — not yet pushed"
                        aria-label="Ahead of upstream"
                      >
                        <Icons.ArrowUpRightIcon size={12} />
                      </span>
                    );
                  }
                  if (behindSet.has(commit.hash)) {
                    return (
                      <span
                        className={styles.commitSyncIndicator}
                        title="Behind upstream — not yet pulled"
                        aria-label="Behind upstream"
                      >
                        <Icons.ArrowDownLeftIcon size={12} />
                      </span>
                    );
                  }

                  return (
                    <span
                      className={styles.commitSyncIndicator}
                      aria-hidden="true"
                    />
                  );
                })()}
              </CommitRow>
            );
          })}
          {hasMore && (
            <div ref={sentinelRef} className={styles.loadingMore}>
              {loadingMore ? "Loading more..." : ""}
            </div>
          )}
          {commits.length === 0 && (
            <div className={styles.emptyState}>No commits</div>
          )}
        </div>
      </div>
    </ResizablePanel>
  );
}
