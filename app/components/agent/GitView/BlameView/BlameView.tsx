/**
 * Phase 11 — Git Blame view.
 *
 * Renders file content with a BlameGutter from Peacock alongside line numbers.
 * Clicking a gutter row reveals the commit in History via requestFocusCommit.
 * The header exposes a "step back" link to blame the file at the parent commit,
 * and a "View History" link to open FileHistoryView for the same path.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  BlameGutter,
  Button,
  GitErrorBanner,
  GitSkeleton,
  Icons,
} from "@argus/peacock";
import {
  gitBlameFile,
  gitReadBlobAtRef,
  type BlameChunk,
} from "../../../../lib/ipc";
import { setGitBlameView } from "../../../../stores/editorStore";
import { requestFocusCommit } from "../../../../stores/gitUiStore";
import styles from "./BlameView.module.css";

const LINE_HEIGHT = 18;

interface BlameViewProps {
  onRevealInHistory?: () => void;
  onShowHistory?: () => void;
  repoRoot: string;
  sessionId: string;
}

export function BlameView({
  sessionId,
  repoRoot: _repoRoot,
  onShowHistory,
  onRevealInHistory,
}: BlameViewProps) {
  const location = useLocation();
  const { path, ref } = useMemo(() => {
    const sp = new URLSearchParams(location.search);

    return {
      path: sp.get("path") ?? "",
      ref: sp.get("ref") ?? undefined,
    };
  }, [location.search]);

  const [chunks, setChunks] = useState<BlameChunk[]>([]);
  const [fileLines, setFileLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | undefined>();

  const gutterRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Sync scroll between gutter and content.
  useEffect(() => {
    const gutter = gutterRef.current;
    const content = contentRef.current;
    if (!gutter || !content) {
      return;
    }
    let syncing = false;
    const onGutterScroll = () => {
      if (syncing) {
        return;
      }
      syncing = true;
      content.scrollTop = gutter.scrollTop;
      syncing = false;
    };
    const onContentScroll = () => {
      if (syncing) {
        return;
      }
      syncing = true;
      gutter.scrollTop = content.scrollTop;
      syncing = false;
    };
    gutter.addEventListener("scroll", onGutterScroll);
    content.addEventListener("scroll", onContentScroll);

    return () => {
      gutter.removeEventListener("scroll", onGutterScroll);
      content.removeEventListener("scroll", onContentScroll);
    };
  }, []);

  useEffect(() => {
    if (!path) {
      return;
    }
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect --
       Async data fetch — established Argus pattern. */
    setLoading(true);
    setError(null);
    setChunks([]);
    setFileLines([]);
    setSelectedHash(undefined);
    /* eslint-enable react-hooks/set-state-in-effect */

    const blameRef = ref ?? "HEAD";

    Promise.all([
      gitBlameFile(sessionId, path, ref),
      gitReadBlobAtRef(sessionId, path, blameRef),
    ])
      .then(([blameChunks, base64Content]) => {
        if (cancelled) {
          return;
        }
        setChunks(blameChunks);
        // Decode base64 → UTF-8 text
        const decoded = atob(base64Content);
        const text = new TextDecoder().decode(
          Uint8Array.from(decoded, (c) => c.charCodeAt(0)),
        );
        setFileLines(text.split("\n"));
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
  }, [sessionId, path, ref]);

  // Build a set of lines highlighted by the currently selected chunk.
  const highlightedLines = useMemo<Set<number>>(() => {
    if (!selectedHash) {
      return new Set();
    }
    const set = new Set<number>();
    for (const chunk of chunks) {
      if (chunk.commitHash === selectedHash) {
        for (let i = 0; i < chunk.lineCount; i++) {
          set.add(chunk.lineStart + i);
        }
      }
    }

    return set;
  }, [selectedHash, chunks]);

  const handleChunkClick = (hash: string) => {
    setSelectedHash(hash);
    requestFocusCommit(hash);
    onRevealInHistory?.();
  };

  // Find parent commit of the selected hash so we can step back through blame.
  const handleBlameParent = () => {
    if (!selectedHash || !path) {
      return;
    }
    // Step back one commit: use "<hash>^"
    setGitBlameView(path, `${selectedHash}^`);
  };

  if (!path) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>No file selected for blame.</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Icons.BlameIcon size={12} />
          Blame of <code>{path}</code>
          {ref && <span className={styles.headerRef}>{ref.slice(0, 7)}</span>}
        </div>
        <div className={styles.headerActions}>
          {selectedHash && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleBlameParent}
              title="Blame at parent commit"
            >
              Blame parent
            </Button>
          )}
          {onShowHistory && (
            <Button size="sm" variant="ghost" onClick={onShowHistory}>
              File History
            </Button>
          )}
        </div>
      </div>

      {loading && <GitSkeleton variant="commit-log" />}
      {error && <GitErrorBanner kind="unknown" message={error} />}

      {!loading && !error && chunks.length > 0 && (
        <div className={styles.body}>
          <div className={styles.gutterWrapper} ref={gutterRef}>
            <BlameGutter
              chunks={chunks}
              lineHeight={LINE_HEIGHT}
              selectedHash={selectedHash}
              onChunkClick={handleChunkClick}
            />
          </div>
          <div className={styles.fileContent} ref={contentRef}>
            <table className={styles.lineTable}>
              <tbody>
                {fileLines.map((line, idx) => {
                  const lineNum = idx + 1;
                  const isHighlighted = highlightedLines.has(lineNum);

                  return (
                    <tr
                      key={lineNum}
                      className={`${styles.lineRow} ${isHighlighted ? styles.highlighted : ""}`}
                    >
                      <td className={styles.lineNumber}>{lineNum}</td>
                      <td className={styles.lineCode}>{line}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && chunks.length === 0 && (
        <div className={styles.empty}>No blame data for this file.</div>
      )}
    </div>
  );
}
