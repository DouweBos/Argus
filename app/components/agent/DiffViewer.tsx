import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  getWorkspaceFullDiff,
  getWorkspaceStagedDiff,
  getWorkspaceUntrackedDiff,
  getWorkspaceConflicts,
  stageFile,
  unstageFile,
} from "../../lib/ipc";
import { useIpcEvent } from "../../hooks/useIpcEvent";
import { ResizablePanel } from "../layout/ResizablePanel";
import { parseDiff, mergeStaged } from "../../lib/diffParser";
import { CommitPanel } from "./CommitPanel";
import { FileList } from "./FileList";
import { FileDiffView } from "./FileDiffView";
import { ChangesToolbar } from "./ChangesToolbar";
import { CheckIcon, FileIcon, PlusIcon } from "../shared/Icons";
import styles from "./DiffViewer.module.css";

interface DiffViewerProps {
  baseBranch?: null | string;
  branchName?: string;
  onFileCountChange?: (count: number) => void;
  repoRoot: string;
  workspaceId: string;
}

function MinusIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z" />
    </svg>
  );
}

function FilterIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z" />
    </svg>
  );
}

const INITIAL_SELECTION = new Set([0]);

export function DiffViewer({
  workspaceId,
  baseBranch,
  branchName,
  repoRoot,
  onFileCountChange,
}: DiffViewerProps) {
  const [fullDiff, setFullDiff] = useState<null | string>(null);
  const [stagedDiff, setStagedDiff] = useState<null | string>(null);
  const [untrackedDiff, setUntrackedDiff] = useState<null | string>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [selectedIndices, setSelectedIndices] =
    useState<Set<number>>(INITIAL_SELECTION);
  const [searchQuery, setSearchQuery] = useState("");
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchDiff = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [full, staged, untracked] = await Promise.all([
        getWorkspaceFullDiff(workspaceId),
        getWorkspaceStagedDiff(workspaceId),
        getWorkspaceUntrackedDiff(workspaceId),
      ]);
      if (isMounted.current) {
        setFullDiff(full);
        setStagedDiff(staged);
        setUntrackedDiff(untracked);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : "Failed to load diff");
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [workspaceId]);

  const fetchConflicts = useCallback(async () => {
    if (!baseBranch) {
      setConflictFiles([]);
      return;
    }
    try {
      const conflicts = await getWorkspaceConflicts(workspaceId);
      setConflictFiles(conflicts);
    } catch {
      setConflictFiles([]);
    }
  }, [workspaceId, baseBranch]);

  useEffect(() => {
    fetchDiff();
    fetchConflicts();
  }, [fetchDiff, fetchConflicts]);

  useIpcEvent(`workspace:diff-changed:${workspaceId}`, () => {
    fetchDiff();
  });

  const files = useMemo(() => {
    if (!fullDiff && !untrackedDiff) return [];
    const parsed = fullDiff ? parseDiff(fullDiff) : [];
    const merged = stagedDiff ? mergeStaged(parsed, stagedDiff) : parsed;
    if (untrackedDiff && untrackedDiff.trim()) {
      const untracked = parseDiff(untrackedDiff);
      for (const f of untracked) {
        f.staged = "none";
        f.status = "A";
      }
      return [...merged, ...untracked];
    }
    return merged;
  }, [fullDiff, stagedDiff, untrackedDiff]);

  // Report file count to parent
  useEffect(() => {
    onFileCountChange?.(files.length);
  }, [files.length, onFileCountChange]);

  // Clamp selection when files change
  useEffect(() => {
    if (files.length === 0) {
      setSelectedIndices(new Set());
      return;
    }
    let changed = false;
    const next = new Set<number>();
    for (const idx of selectedIndices) {
      if (idx < files.length) {
        next.add(idx);
      } else {
        changed = true;
      }
    }
    if (next.size === 0) {
      next.add(0);
      changed = true;
    }
    if (changed) {
      setSelectedIndices(next);
    }
  }, [files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedFiles = useMemo(() => {
    const sorted = [...selectedIndices].sort((a, b) => a - b);
    return sorted.map((i) => files[i]).filter(Boolean);
  }, [selectedIndices, files]);

  const handleAction = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
        await fetchDiff();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Operation failed");
      }
    },
    [fetchDiff],
  );

  const handleStageAll = useCallback(async () => {
    for (const f of files) {
      const path = f.newPath || f.oldPath;
      if (f.staged !== "full") {
        await stageFile(workspaceId, path);
      }
    }
    await fetchDiff();
  }, [files, workspaceId, fetchDiff]);

  const handleUnstageAll = useCallback(async () => {
    for (const f of files) {
      const path = f.newPath || f.oldPath;
      if (f.staged !== "none") {
        await unstageFile(workspaceId, path);
      }
    }
    await fetchDiff();
  }, [files, workspaceId, fetchDiff]);

  const handleStageSelected = useCallback(async () => {
    for (const f of selectedFiles) {
      const path = f.newPath || f.oldPath;
      if (f.staged !== "full") {
        await stageFile(workspaceId, path);
      }
    }
    await fetchDiff();
  }, [selectedFiles, workspaceId, fetchDiff]);

  const handleUnstageSelected = useCallback(async () => {
    for (const f of selectedFiles) {
      const path = f.newPath || f.oldPath;
      if (f.staged !== "none") {
        await unstageFile(workspaceId, path);
      }
    }
    await fetchDiff();
  }, [selectedFiles, workspaceId, fetchDiff]);

  const allStaged = files.length > 0 && files.every((f) => f.staged === "full");
  const anyStaged = files.length > 0 && files.some((f) => f.staged !== "none");

  if (isLoading && fullDiff === null) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingFull}>
          <span className={styles.spinner} />
          Loading changes...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <p className={styles.errorMsg}>{error}</p>
      </div>
    );
  }

  const noChanges = !fullDiff || fullDiff.trim() === "";

  return (
    <div className={styles.container}>
      {/* Full-width header bar */}
      <ChangesToolbar
        branchName={branchName}
        fileCount={files.length}
        workspaceId={workspaceId}
        repoRoot={repoRoot}
        onRefresh={fetchDiff}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Content row: file list + diff detail */}
      <div className={styles.contentRow}>
        <ResizablePanel
          defaultWidth={0.4}
          minWidth={0.15}
          maxWidth={0.6}
          side="left"
        >
          <div className={styles.fileList}>
            {/* Breadcrumb */}
            <div className={styles.breadcrumb}>
              <span className={styles.breadcrumbBranch}>
                {branchName ?? "unknown"}
              </span>
              <span className={styles.breadcrumbSep}>&gt;</span>
              <span className={styles.breadcrumbTracking}>origin/...</span>
            </div>
            <CommitPanel
              workspaceId={workspaceId}
              allStaged={allStaged}
              anyStaged={anyStaged}
              onStageAll={handleStageAll}
              onUnstageAll={handleUnstageAll}
              onAction={handleAction}
              onCommitted={fetchDiff}
            />
            {conflictFiles.length > 0 && baseBranch && (
              <div className={styles.conflictBanner}>
                {conflictFiles.length}{" "}
                {conflictFiles.length === 1 ? "conflict" : "conflicts"} with{" "}
                {baseBranch}
              </div>
            )}
            <FileList
              files={files}
              workspaceId={workspaceId}
              selectedIndices={selectedIndices}
              onSelectionChange={setSelectedIndices}
              onAction={handleAction}
              searchFilter={searchQuery}
            />
            <div className={styles.bottomBar}>
              <button
                className={styles.bottomBarBtn}
                onClick={handleStageSelected}
                title="Stage selected files"
                disabled={selectedFiles.length === 0}
              >
                <PlusIcon size={12} />
              </button>
              <button
                className={styles.bottomBarBtn}
                onClick={handleUnstageSelected}
                title="Unstage selected files"
                disabled={selectedFiles.length === 0}
              >
                <MinusIcon size={12} />
              </button>
              <div className={styles.bottomBarSpacer} />
              <button className={styles.bottomBarBtn} title="Filter" disabled>
                <FilterIcon size={11} />
              </button>
            </div>
          </div>
        </ResizablePanel>

        {/* Right: diff detail */}
        <div className={styles.diffDetail}>
          {noChanges ? (
            <div className={styles.emptyState}>
              <CheckIcon size={24} />
              <p>No changes</p>
            </div>
          ) : selectedFiles.length === 1 ? (
            <FileDiffView
              file={selectedFiles[0]}
              workspaceId={workspaceId}
              onAction={handleAction}
            />
          ) : selectedFiles.length > 1 ? (
            <div className={styles.diffScroll}>
              {selectedFiles.map((file) => (
                <div
                  key={file.newPath || file.oldPath}
                  className={styles.diffScrollItem}
                >
                  <FileDiffView
                    file={file}
                    workspaceId={workspaceId}
                    onAction={handleAction}
                    inline
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <FileIcon size={48} />
              <p>No file selected</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
