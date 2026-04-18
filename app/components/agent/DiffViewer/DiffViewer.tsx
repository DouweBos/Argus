import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Icons } from "@argus/peacock";
import { useDiffFiles } from "../../../hooks/useDiffFiles";
import { gitIndexPath } from "../../../lib/diffParser";
import { stageAll, stageFile, unstageAll, unstageFile } from "../../../lib/ipc";
import { ResizablePanel } from "../../layout/ResizablePanel";
import { ChangesToolbar } from "../ChangesToolbar";
import { CommitPanel } from "../CommitPanel";
import { FileDiffView } from "../FileDiffView";
import { FileList } from "../FileList";
import styles from "./DiffViewer.module.css";

interface DiffViewerProps {
  baseBranch?: string | null;
  branchName?: string;
  onFileCountChange?: (count: number) => void;
  repoRoot: string;
  workspaceId: string;
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
  const [actionError, setActionError] = useState<string | null>(null);

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
    await stageAll(workspaceId);
  }, [workspaceId]);

  const handleUnstageAll = useCallback(async () => {
    await unstageAll(workspaceId);
  }, [workspaceId]);

  const handleStageSelected = useCallback(async () => {
    for (const f of selectedFiles) {
      const path = gitIndexPath(f);
      if (f.staged !== "full") {
        await stageFile(workspaceId, path);
      }
    }

    await fetchDiff();
  }, [selectedFiles, workspaceId, fetchDiff]);

  const handleUnstageSelected = useCallback(async () => {
    for (const f of selectedFiles) {
      const path = gitIndexPath(f);
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

  let diffDetailContent: ReactNode;
  if (noChanges) {
    diffDetailContent = (
      <div className={styles.emptyState}>
        <Icons.CheckIcon size={24} />
        <p>No changes</p>
      </div>
    );
  } else if (selectedFiles.length === 1) {
    diffDetailContent = (
      <FileDiffView
        file={selectedFiles[0]}
        workspaceId={workspaceId}
        onAction={handleAction}
      />
    );
  } else if (selectedFiles.length > 1) {
    diffDetailContent = (
      <div className={styles.diffScroll}>
        {selectedFiles.map((file) => (
          <div
            key={file.newPath || file.oldPath}
            className={styles.diffScrollItem}
          >
            <FileDiffView
              file={file}
              inline
              workspaceId={workspaceId}
              onAction={handleAction}
            />
          </div>
        ))}
      </div>
    );
  } else {
    diffDetailContent = (
      <div className={styles.emptyState}>
        <Icons.FileIcon size={48} />
        <p>No file selected</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Full-width header bar */}
      <ChangesToolbar
        branchName={branchName}
        fileCount={files.length}
        repoRoot={repoRoot}
        searchQuery={searchQuery}
        workspaceId={workspaceId}
        onRefresh={fetchDiff}
        onSearchChange={setSearchQuery}
      />

      {/* Content row: file list + diff detail */}
      <div className={styles.contentRow}>
        <ResizablePanel
          defaultWidth={0.4}
          maxWidth={0.6}
          minWidth={0.15}
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
              allStaged={allStaged}
              anyStaged={anyStaged}
              workspaceId={workspaceId}
              onAction={handleAction}
              onCommitted={fetchDiff}
              onStageAll={handleStageAll}
              onUnstageAll={handleUnstageAll}
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
              searchFilter={searchQuery}
              selectedIndices={selectedIndices}
              workspaceId={workspaceId}
              onAction={handleAction}
              onSelectionChange={setSelectedIndices}
            />
            <div className={styles.bottomBar}>
              <button
                className={styles.bottomBarBtn}
                disabled={selectedFiles.length === 0}
                title="Stage selected files"
                onClick={handleStageSelected}
              >
                <Icons.PlusIcon size={12} />
              </button>
              <button
                className={styles.bottomBarBtn}
                disabled={selectedFiles.length === 0}
                title="Unstage selected files"
                onClick={handleUnstageSelected}
              >
                <Icons.MinusIcon size={12} />
              </button>
              <div className={styles.bottomBarSpacer} />
              <button className={styles.bottomBarBtn} disabled title="Filter">
                <Icons.FilterIcon size={11} />
              </button>
            </div>
          </div>
        </ResizablePanel>

        {/* Right: diff detail */}
        <div className={styles.diffDetail}>{diffDetailContent}</div>
      </div>
    </div>
  );
}
