import type { DiffFile } from "../../../lib/diffParser";
import type { GitCommit } from "../../../lib/ipc";
import type { RefObject } from "react";
import { useCallback, useMemo, useState } from "react";
import { parseDiff } from "../../../lib/diffParser";
import { gitShowCommit } from "../../../lib/ipc";
import { useGitShortcuts } from "../GitView/useGitShortcuts";

interface CommitDiff {
  clearDiff: () => void;
  diffFiles: DiffFile[];
  expandAll: () => void;
  expandedFiles: Set<number>;
  filesViewMode: "changeset" | "tree";
  loadCommitDiff: (commit: GitCommit) => Promise<void>;
  setFilesViewMode: (mode: "changeset" | "tree") => void;
  toggleFile: (i: number) => void;
}

export function useCommitDiff(
  sessionId: string,
  scope: "project" | "session",
  commits: GitCommit[],
  selectedIdxRef: RefObject<number>,
  selectCommitRef: RefObject<(idx: number) => Promise<void> | void>,
): CommitDiff {
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(
    () => new Set(),
  );
  const [filesViewMode, setFilesViewMode] = useState<"changeset" | "tree">(
    "changeset",
  );

  const loadCommitDiff = useCallback(
    async (commit: GitCommit) => {
      setExpandedFiles(new Set());
      setDiffFiles([]);
      try {
        const diff = await gitShowCommit(sessionId, commit.hash);
        const parsed = diff ? parseDiff(diff) : [];
        setDiffFiles(parsed);
        if (parsed.length > 0) {
          setExpandedFiles(new Set([0]));
        }
      } catch {
        setDiffFiles([]);
      }
    },
    [sessionId],
  );

  const clearDiff = useCallback(() => {
    setDiffFiles([]);
    setExpandedFiles(new Set());
  }, []);

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

  // Shortcut handlers read selectedIdx and selectCommit via refs so that
  // the useMemo only depends on commits and the stable refs themselves.
  const shortcutHandlers = useMemo(
    () => ({
      "copy-commit-hash": () => {
        const idx = selectedIdxRef.current;
        const c = commits[idx];
        if (c) {
          navigator.clipboard?.writeText(c.hash).catch(() => undefined);
        }
      },
      "copy-commit-summary": () => {
        const idx = selectedIdxRef.current;
        const c = commits[idx];
        if (c) {
          navigator.clipboard
            ?.writeText(`${c.abbreviatedHash}  ${c.subject}`)
            .catch(() => undefined);
        }
      },
      "open-commit": () => {
        const idx = selectedIdxRef.current;
        const selectCommit = selectCommitRef.current;
        if (idx >= 0) {
          selectCommit(idx);
        } else if (commits.length > 0) {
          selectCommit(0);
        }
      },
    }),
    [commits, selectedIdxRef, selectCommitRef],
  );
  useGitShortcuts(scope, shortcutHandlers);

  return {
    clearDiff,
    diffFiles,
    expandAll,
    expandedFiles,
    filesViewMode,
    loadCommitDiff,
    setFilesViewMode,
    toggleFile,
  };
}
