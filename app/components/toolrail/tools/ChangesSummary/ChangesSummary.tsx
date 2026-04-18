import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import { useDiffFiles } from "../../../../hooks/useDiffFiles";
import { useMergeStatus } from "../../../../hooks/useMergeStatus";
import { useWorkspaces } from "../../../../stores/workspaceStore";
import { FileTypeIcon } from "../../../shared/Icons";
import styles from "./ChangesSummary.module.css";

type DiffLineType = "add" | "context" | "remove";

function diffLineToneClass(type: DiffLineType): string {
  if (type === "add") {
    return styles.lineAdd;
  }
  if (type === "remove") {
    return styles.lineRemove;
  }

  return "";
}

function diffLineGutterPrefix(type: DiffLineType): string {
  if (type === "add") {
    return "+";
  }
  if (type === "remove") {
    return "-";
  }

  return " ";
}

interface ChangesSummaryProps {
  workspaceId: string | null;
}

export function ChangesSummary({ workspaceId }: ChangesSummaryProps) {
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () =>
      workspaceId
        ? (workspaces.find((w) => w.id === workspaceId) ?? null)
        : null,
    [workspaceId, workspaces],
  );

  if (!workspaceId) {
    return null;
  }

  return (
    <ChangesSummaryInner workspace={workspace} workspaceId={workspaceId} />
  );
}

interface InnerProps {
  workspace: {
    base_branch?: string | null;
    kind: string;
  } | null;
  workspaceId: string;
}

function ChangesSummaryInner({ workspaceId, workspace }: InnerProps) {
  const { files, isLoading } = useDiffFiles(workspaceId);
  const { conflicts, hasStaged, isMerging, mergeError, handleMerge } =
    useMergeStatus(workspaceId);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const fileRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  const fileStats = useMemo(() => {
    return files.map((f) => {
      const path = f.newPath || f.oldPath;
      const parts = path.split("/");
      const fileName = parts.pop() ?? path;
      const directory = parts.join("/");
      let additions = 0;
      let deletions = 0;
      for (const hunk of f.hunks) {
        for (const line of hunk.lines) {
          if (line.type === "add") {
            additions++;
          }
          if (line.type === "remove") {
            deletions++;
          }
        }
      }

      return { path, fileName, directory, additions, deletions };
    });
  }, [files]);

  const totalAdditions = useMemo(
    () => fileStats.reduce((s, f) => s + f.additions, 0),
    [fileStats],
  );
  const totalDeletions = useMemo(
    () => fileStats.reduce((s, f) => s + f.deletions, 0),
    [fileStats],
  );

  const navigateToFile = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, files.length - 1));
      setCurrentFileIndex(clamped);
      const el = fileRefs.current.get(clamped);
      el?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    },
    [files.length],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
        return;
      }

      if (!container.contains(document.activeElement)) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }

      if (files.length === 0) {
        return;
      }

      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      navigateToFile(currentFileIndex + delta);
    };

    container.addEventListener("keydown", handleKeyDown);

    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [files.length, currentFileIndex, navigateToFile]);

  const showMerge = workspace?.kind === "worktree" && workspace.base_branch;
  const hasConflicts = conflicts.length > 0;
  const canMerge = hasStaged && !hasConflicts && !isMerging;

  if (isLoading && files.length === 0) {
    return (
      <div ref={containerRef} className={styles.container} tabIndex={-1}>
        <div className={styles.empty}>
          <span className={styles.emptyText}>Loading changes...</span>
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div ref={containerRef} className={styles.container} tabIndex={-1}>
        <div className={styles.empty}>
          <Icons.CheckIcon size={24} />
          <span className={styles.emptyText}>No changes</span>
        </div>
        {showMerge && (
          <div className={styles.bottomBar}>
            <button
              className={styles.mergeBtn}
              disabled={!canMerge}
              onClick={handleMerge}
            >
              <Icons.MergeIcon size={12} />
              {isMerging ? "Merging..." : "Apply Changes Locally"}
            </button>
          </div>
        )}
      </div>
    );
  }

  const safeIndex = Math.min(currentFileIndex, files.length - 1);

  let mergeBtnTitle: string | undefined;
  if (hasConflicts) {
    mergeBtnTitle = `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""}`;
  } else if (!hasStaged) {
    mergeBtnTitle = "Stage changes to merge";
  }

  return (
    <div ref={containerRef} className={styles.container} tabIndex={-1}>
      {/* Stats header */}
      <div className={styles.statsHeader}>
        <span className={styles.statsLabel}>
          {files.length} file{files.length !== 1 ? "s" : ""} changed
        </span>
        <div className={styles.statsBadge}>
          <span className={styles.statsAdd}>+{totalAdditions}</span>
          <span className={styles.statsDel}>-{totalDeletions}</span>
        </div>
      </div>

      {/* Scrollable diff content */}
      <div className={styles.diffContent}>
        {files.map((file, fileIndex) => {
          const stats = fileStats[fileIndex];

          return (
            <div
              key={stats.path}
              ref={(el) => {
                if (el) {
                  fileRefs.current.set(fileIndex, el);
                } else {
                  fileRefs.current.delete(fileIndex);
                }
              }}
              className={styles.fileSection}
            >
              {/* File header */}
              <div className={styles.fileHeader}>
                <span className={styles.fileIcon}>
                  <FileTypeIcon name={stats.fileName} size={16} />
                </span>
                <div className={styles.fileInfo}>
                  <span className={styles.fileName}>{stats.fileName}</span>
                  {stats.directory && (
                    <span className={styles.fileDir}>{stats.directory}</span>
                  )}
                </div>
                <div className={styles.fileStats}>
                  {stats.additions > 0 && (
                    <span className={styles.statsAdd}>+{stats.additions}</span>
                  )}
                  {stats.deletions > 0 && (
                    <span className={styles.statsDel}>-{stats.deletions}</span>
                  )}
                </div>
              </div>

              {/* Diff lines */}
              <div className={styles.diffLines}>
                {file.hunks.map((hunk, hi) => (
                  <div key={hi}>
                    {hi > 0 && (
                      <div className={styles.hunkSep}>
                        <span className={styles.hunkSepText}>
                          {hunk.header}
                        </span>
                      </div>
                    )}
                    {hunk.lines.map((line, li) => (
                      <div
                        key={li}
                        className={`${styles.line} ${diffLineToneClass(line.type)}`}
                      >
                        <span className={styles.lineNum}>
                          {line.type === "remove"
                            ? (line.oldNum ?? "")
                            : (line.newNum ?? "")}
                        </span>
                        <span className={styles.lineText}>
                          {diffLineGutterPrefix(line.type)}
                          {line.content || " "}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom bar: file nav + merge action */}
      <div className={styles.bottomBar}>
        <div className={styles.navGroup}>
          <button
            className={styles.navBtn}
            disabled={safeIndex <= 0}
            onClick={() => navigateToFile(safeIndex - 1)}
          >
            <Icons.ChevronLeftIcon size={10} />
          </button>
          <span className={styles.navLabel}>
            {safeIndex + 1}/{files.length} files
          </span>
          <button
            className={styles.navBtn}
            disabled={safeIndex >= files.length - 1}
            onClick={() => navigateToFile(safeIndex + 1)}
          >
            <Icons.ChevronRightIcon size={10} />
          </button>
        </div>
        {showMerge && (
          <button
            className={styles.mergeBtn}
            disabled={!canMerge}
            title={mergeBtnTitle}
            onClick={handleMerge}
          >
            <Icons.MergeIcon size={12} />
            {isMerging ? "Merging..." : "Apply Changes Locally"}
          </button>
        )}
        {mergeError && <span className={styles.mergeError}>{mergeError}</span>}
      </div>
    </div>
  );
}
