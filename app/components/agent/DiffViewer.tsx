import { useState, useCallback, useMemo, useEffect } from "react";
import { stageFile, unstageFile } from "../../lib/ipc";
import { useDiffFiles } from "../../hooks/useDiffFiles";
import { ResizablePanel } from "../layout/ResizablePanel";
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
  const {
    files,
    conflictFiles,
    isLoading,
    error: fetchError,
    refetch: fetchDiff,
  } = useDiffFiles(workspaceId, { baseBranch });
  const [selectedIndices, setSelectedIndices] =
    useState<Set<number>>(INITIAL_SELECTION);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionError, setActionError] = useState<null | string>(null);

  // Report file count to parent (skip zero during initial load to avoid badge flicker)
  useEffect(() => {
    if (!isLoading || files.length > 0) {
      onFileCountChange?.(files.length);
    }
  }, [files.length, isLoading, onFileCountChange]);

  // Clamp selection when file count changes (adjust during render)
  const [prevFileCount, setPrevFileCount] = useState(files.length);
  if (files.length !== prevFileCount) {
    setPrevFileCount(files.length);
    if (files.length === 0) {
      setSelectedIndices(new Set());
    } else {
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
    }
  }

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
        setActionError(err instanceof Error ? err.message : "Operation failed");
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

  if (isLoading && files.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingFull}>
          <span className={styles.spinner} />
          Loading changes...
        </div>
      </div>
    );
  }

  const error = fetchError || actionError;
  if (error) {
    return (
      <div className={styles.container}>
        <p className={styles.errorMsg}>{error}</p>
      </div>
    );
  }

  const noChanges = files.length === 0;

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
