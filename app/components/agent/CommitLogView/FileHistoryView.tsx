/**
 * Phase 4 H8 — show every commit that touched a particular file (with
 * `--follow` so renames are tracked).
 *
 * Each row is selectable; clicking shows the diff at that commit, scoped to
 * the file. Close button returns to whatever the parent was rendering.
 */

import { useEffect, useState } from "react";
import { Button, GitErrorBanner, GitSkeleton, Icons } from "@argus/peacock";
import { parseDiff, type DiffFile } from "../../../lib/diffParser";
import {
  gitFileHistory,
  gitShowCommit,
  type GitCommit,
} from "../../../lib/ipc";
import { setGitBlameView } from "../../../stores/editorStore";
import { FileDiffView } from "../FileDiffView";
import styles from "./FileHistoryView.module.css";

export interface FileHistoryViewProps {
  onClose: () => void;
  path: string;
  sessionId: string;
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function FileHistoryView({
  sessionId,
  path,
  onClose,
}: FileHistoryViewProps) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect --
       Async data fetch — initial setState is the established Argus pattern. */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    gitFileHistory(sessionId, path)
      .then((c) => {
        if (cancelled) {
          return;
        }
        setCommits(c);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, path]);

  const selectCommit = async (idx: number): Promise<void> => {
    setSelectedIdx(idx);
    const c = commits[idx];
    if (!c) {
      return;
    }
    try {
      const diff = await gitShowCommit(sessionId, c.hash);
      const all = diff ? parseDiff(diff) : [];
      // Filter to the file (best-effort — rename history may have older
      // names so accept any path that ends with our basename if no exact
      // match is found).
      const exact = all.filter((f) => f.newPath === path || f.oldPath === path);
      setDiffFiles(exact.length > 0 ? exact : all);
    } catch {
      setDiffFiles([]);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>
          <Icons.HistoryIcon size={12} /> History of <code>{path}</code>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      {loading && <GitSkeleton variant="commit-log" />}
      {error && <GitErrorBanner kind="unknown" message={error} />}
      {!loading && !error && (
        <div className={styles.body}>
          <div className={styles.list}>
            {commits.map((c, i) => (
              <button
                key={c.hash}
                className={`${styles.row} ${i === selectedIdx ? styles.rowActive : ""}`}
                onClick={() => selectCommit(i)}
              >
                <span className={styles.hash}>{c.abbreviatedHash}</span>
                <span className={styles.subject}>{c.subject}</span>
                <span className={styles.author}>{c.author}</span>
                <span className={styles.date}>{shortDate(c.date)}</span>
                <span
                  className={styles.blameLink}
                  title="Blame at this revision"
                  onClick={(e) => {
                    e.stopPropagation();
                    setGitBlameView(path, c.hash);
                  }}
                >
                  <Icons.BlameIcon size={11} />
                  Blame
                </span>
              </button>
            ))}
            {commits.length === 0 && (
              <div className={styles.empty}>No history for this file</div>
            )}
          </div>
          <div className={styles.detail}>
            {diffFiles.map((f, i) => (
              <FileDiffView
                key={i}
                file={f}
                inline
                readOnly
                sessionId={sessionId}
                onAction={async () => undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
