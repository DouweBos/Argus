/**
 * Phase 4 — search-aware, cursor-paginated, multi-feature commit log.
 *
 * Splits responsibilities into:
 *   - `useCursorLog` — pagination + race cancellation
 *   - `useCommitSelection` — selection state, keyboard navigation, multi-select
 *   - `useCommitLogOperations` — rebase/squash/reorder mutations + autosquash
 *   - `useHeadAndRemote` — tipHash, headHashes, remoteUrl side-effects
 *   - `useAheadBehind` — ahead/behind set computation
 *   - `useCommitDiff` — diff loading, file expansion, keyboard shortcuts
 *   - `CommitListPanel` — resizable commit list with toolbar and filters
 *   - `CommitDialogs` — all modals, dialogs, and context menus
 *   - `HistoryFilters` — search bar + filters
 *   - `CommitContextMenu` — right-click menu (session subset + project stubs)
 *   - `CompareView` — `comparisonRange` rendering
 *   - `FileHistoryView` — `fileHistoryBySession` rendering
 *   - `CommitDetailPanel` — right-pane commit detail view
 */

import type { GitCommit } from "../../../lib/ipc";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GitErrorBanner, GitSkeleton, Icons } from "@argus/peacock";
import { buildGraphLanes } from "../../../lib/gitGraph";
import { gravatarUrl as buildGravatarUrl } from "../../../lib/md5";
import {
  closeFileHistory,
  EMPTY_HISTORY_FILTERS,
  setHistoryFilters,
  useComparisonRange,
  useFileHistoryRequest,
  useFocusCommitHash,
  useHistoryFilters,
  type HistoryFilters as HistoryFiltersValue,
} from "../../../stores/gitUiStore";
import styles from "../HistoryView/HistoryView.module.css";
import { CommitDetailPanel } from "./CommitDetailPanel";
import { CommitDialogs } from "./CommitDialogs";
import { CommitListPanel } from "./CommitListPanel";
import { CompareView } from "./CompareView";
import { FileHistoryView } from "./FileHistoryView";
import { useAheadBehind } from "./useAheadBehind";
import { useCommitDiff } from "./useCommitDiff";
import { useCommitLogOperations } from "./useCommitLogOperations";
import { useCommitSelection } from "./useCommitSelection";
import { useCursorLog } from "./useCursorLog";
import { useHeadAndRemote } from "./useHeadAndRemote";

interface CommitLogViewProps {
  allBranches: boolean;
  baseBranch?: string | null;
  scope?: "project" | "session";
  sessionId: string;
  showGraph?: boolean;
}

interface CommitMenuState {
  commitIndex: number;
  x: number;
  y: number;
}

export function CommitLogView({
  sessionId,
  allBranches,
  baseBranch,
  scope = "session",
  showGraph = true,
}: CommitLogViewProps) {
  const persistedFilters = useHistoryFilters(sessionId);
  const filters = useMemo<HistoryFiltersValue>(() => {
    if (!allBranches && persistedFilters.branch === "") {
      return persistedFilters;
    }

    return persistedFilters;
  }, [persistedFilters, allBranches]);
  const onFiltersChange = useCallback(
    (next: HistoryFiltersValue) => {
      setHistoryFilters(sessionId, next);
    },
    [sessionId],
  );

  const [autosquashDismissed, setAutosquashDismissed] = useState<string | null>(
    null,
  );

  const [prevSession, setPrevSession] = useState(sessionId);
  if (prevSession !== sessionId) {
    setPrevSession(sessionId);
    setHistoryFilters(sessionId, EMPTY_HISTORY_FILTERS);
    setAutosquashDismissed(null);
  }

  const ipcFilters = useMemo(
    () => ({
      query: filters.query || undefined,
      author: filters.author || undefined,
      since: filters.since || undefined,
      until: filters.until || undefined,
      branch: allBranches ? filters.branch || undefined : "HEAD",
      refType: filters.refType,
    }),
    [filters, allBranches],
  );

  const log = useCursorLog(sessionId, ipcFilters);
  const { commits, loading, loadingMore, hasMore, error } = log;

  const [contextMenu, setContextMenu] = useState<CommitMenuState | null>(null);
  const [shaMenu, setShaMenu] = useState<{
    sha: string;
    x: number;
    y: number;
  } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<GitCommit | null>(null);
  const [resetDirectTarget, setResetDirectTarget] = useState<{
    commit: GitCommit;
    mode: "hard" | "mixed" | "soft";
  } | null>(null);
  const [revertTarget, setRevertTarget] = useState<GitCommit | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GitCommit | null>(null);
  const [cherryPickTarget, setCherryPickTarget] = useState<GitCommit | null>(
    null,
  );
  const [createBranchTarget, setCreateBranchTarget] =
    useState<GitCommit | null>(null);
  const [createTagTarget, setCreateTagTarget] = useState<GitCommit | null>(
    null,
  );

  const sentinelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { tipHash, headHashes, remoteUrl, isOtherCommitOnHead } =
    useHeadAndRemote(sessionId, commits);

  const { aheadSet, behindSet } = useAheadBehind(
    sessionId,
    commits,
    baseBranch,
  );

  // selectCommit ref to break the circular dep: useCommitDiff needs selectCommit
  // but useCommitSelection (which provides selectCommit) needs loadCommitDiff/
  // clearDiff from useCommitDiff. The ref is updated after both hooks resolve.
  const selectCommitRef = useRef<(idx: number) => Promise<void> | void>(
    () => undefined,
  );
  // selectedIdx ref so useCommitDiff's shortcut handlers stay current without
  // needing selectedIdx at hook-call time.
  const selectedIdxRef = useRef<number>(-1);

  const {
    diffFiles,
    expandedFiles,
    filesViewMode,
    setFilesViewMode,
    loadCommitDiff,
    clearDiff,
    toggleFile,
    expandAll,
  } = useCommitDiff(sessionId, scope, commits, selectedIdxRef, selectCommitRef);

  const {
    handleCommitClick,
    handleCommitMouseDown,
    selectCommit,
    selectedIdx,
    selectedIndices,
    setSelectedHashes,
    visibleSelectedHashes,
  } = useCommitSelection(commits, listRef, loadCommitDiff, clearDiff);

  // Keep refs in sync after each render so useCommitDiff's shortcut handlers
  // always see the latest values without needing them as useMemo deps.
  useLayoutEffect(() => {
    selectCommitRef.current = selectCommit;
    selectedIdxRef.current = selectedIdx;
  });

  const ops = useCommitLogOperations(
    sessionId,
    commits,
    headHashes,
    setSelectedHashes,
  );

  // IntersectionObserver sentinel.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const list = listRef.current;
    if (!sentinel || !list) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
          log.loadMore();
        }
      },
      { root: list, rootMargin: "200px" },
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMore, loadingMore, log]);

  const comparisonRange = useComparisonRange();
  const focusCommitHash = useFocusCommitHash();
  const fileHistoryReq = useFileHistoryRequest(sessionId);

  const graphRows = useMemo(
    () => (showGraph ? buildGraphLanes(commits) : []),
    [commits, showGraph],
  );

  const selected = selectedIdx >= 0 ? commits[selectedIdx] : null;

  const gravatarUrl = useMemo(
    () => buildGravatarUrl(selected?.authorEmail ?? null, 80),
    [selected],
  );

  const fileStats = useMemo(() => {
    return diffFiles.map((f) => {
      let adds = 0;
      let dels = 0;
      for (const h of f.hunks) {
        for (const l of h.lines) {
          if (l.type === "add") {
            adds++;
          } else if (l.type === "remove") {
            dels++;
          }
        }
      }

      return { adds, dels };
    });
  }, [diffFiles]);

  const totalAdds = fileStats.reduce((a, s) => a + s.adds, 0);
  const totalDels = fileStats.reduce((a, s) => a + s.dels, 0);

  const requestSquashSelection = useCallback(() => {
    if (selectedIndices.length < 2) {
      return;
    }
    const picked = selectedIndices.map((i) => commits[i]!).filter(Boolean);
    ops.setSquashConfirm({ commits: picked });
  }, [commits, selectedIndices, ops]);

  // Scroll requested commit into view.
  useEffect(() => {
    if (!focusCommitHash) {
      return;
    }
    const idx = commits.findIndex(
      (c) => c.hash === focusCommitHash || c.hash.startsWith(focusCommitHash),
    );
    if (idx >= 0) {
      selectCommit(idx);

      const node = listRef.current?.querySelectorAll(`.${styles.commitItem}`)[
        idx
      ];
      node?.scrollIntoView({ block: "center" });
    }
  }, [focusCommitHash, commits, selectCommit]);

  // Render -----------------------------------------------------------------

  if (loading) {
    return <GitSkeleton variant="commit-log" />;
  }
  if (error) {
    return <GitErrorBanner kind="unknown" message={error} />;
  }

  // File history takes over the detail pane.
  if (fileHistoryReq) {
    return (
      <div className={styles.layoutColumn}>
        <FileHistoryView
          path={fileHistoryReq.path}
          sessionId={sessionId}
          onClose={() => closeFileHistory(sessionId)}
        />
      </div>
    );
  }

  // Compare view replaces the detail pane.
  if (comparisonRange) {
    return (
      <div className={styles.layoutColumn}>
        <CompareView
          fromRef={comparisonRange.from}
          toRef={comparisonRange.to}
          sessionId={sessionId}
        />
      </div>
    );
  }

  const refScopeLabel =
    {
      tags: "Tags",
      remotes: "Remotes",
      locals: "Local Branches",
      all: "All Branches, Remotes, Tags",
    }[filters.refType] ?? "All Branches, Remotes, Tags";

  return (
    <>
      <div className={styles.layoutColumn}>
        <div className={styles.bodyRow}>
          <CommitListPanel
            aheadSet={aheadSet}
            allBranches={allBranches}
            autosquashDismissed={autosquashDismissed}
            behindSet={behindSet}
            commits={commits}
            filters={filters}
            filtersOpen={filtersOpen}
            graphRows={graphRows}
            handleCommitClick={handleCommitClick}
            handleCommitMouseDown={handleCommitMouseDown}
            hasMore={hasMore}
            headHashes={headHashes}
            isOtherCommitOnHead={isOtherCommitOnHead}
            listRef={listRef}
            loadingMore={loadingMore}
            onFiltersChange={onFiltersChange}
            ops={ops}
            refScopeLabel={refScopeLabel}
            selectCommit={selectCommit}
            selectedIdx={selectedIdx}
            sentinelRef={sentinelRef}
            sessionId={sessionId}
            setAutosquashDismissed={setAutosquashDismissed}
            setContextMenu={setContextMenu}
            setFiltersOpen={setFiltersOpen}
            showGraph={showGraph}
            visibleSelectedHashes={visibleSelectedHashes}
          />

          <div className={styles.detailPanel}>
            {selected ? (
              <CommitDetailPanel
                diffFiles={diffFiles}
                expandedFiles={expandedFiles}
                fileStats={fileStats}
                filesViewMode={filesViewMode}
                gravatarUrl={gravatarUrl}
                onExpandAll={expandAll}
                onInteractiveRebaseFromHere={
                  ops.handleInteractiveRebaseFromHere
                }
                onShaContextMenu={(sha, x, y) => setShaMenu({ sha, x, y })}
                onToggleFile={toggleFile}
                onFilesViewModeChange={setFilesViewMode}
                scope={scope}
                selected={selected}
                sessionId={sessionId}
                tipHash={tipHash}
                totalAdds={totalAdds}
                totalDels={totalDels}
              />
            ) : (
              <div className={styles.emptyState}>
                <Icons.FileIcon size={48} />
                <p>Select a commit to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <CommitDialogs
        cherryPickTarget={cherryPickTarget}
        commits={commits}
        contextMenu={contextMenu}
        createBranchTarget={createBranchTarget}
        createTagTarget={createTagTarget}
        deleteTarget={deleteTarget}
        ops={ops}
        remoteUrl={remoteUrl}
        requestSquashSelection={requestSquashSelection}
        resetDirectTarget={resetDirectTarget}
        resetTarget={resetTarget}
        revertTarget={revertTarget}
        selectCommit={selectCommit}
        sessionId={sessionId}
        setCherryPickTarget={setCherryPickTarget}
        setContextMenu={setContextMenu}
        setCreateBranchTarget={setCreateBranchTarget}
        setCreateTagTarget={setCreateTagTarget}
        setDeleteTarget={setDeleteTarget}
        setResetDirectTarget={setResetDirectTarget}
        setResetTarget={setResetTarget}
        setRevertTarget={setRevertTarget}
        setShaMenu={setShaMenu}
        shaMenu={shaMenu}
        visibleSelectedHashes={visibleSelectedHashes}
      />
    </>
  );
}
