import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog, Icons, Input } from "@argus/peacock";
import { gitLog, listBranches, type GitCommit } from "../../../../lib/ipc";
import styles from "./JumpToRef.module.css";

interface BranchEntry {
  kind: "branch";
  name: string;
}

interface CommitEntry {
  commit: GitCommit;
  kind: "commit";
}

type Entry = BranchEntry | CommitEntry;

export interface JumpToRefProps {
  onClose: () => void;
  /**
   * Called when the user picks an entry. The parent should switch to History
   * view + scroll the commit into view (for branch picks the most recent
   * commit on that branch, for commit picks the chosen hash).
   */
  onSelectBranch: (branchName: string) => void;
  onSelectCommit: (hash: string) => void;
  /**
   * Repo root used to fetch the branch list. Branches list IPC is keyed off
   * the repo root rather than the session id.
   */
  repoRoot: string;
  sessionId: string;
}

/**
 * Cmd+L "go to ref" palette: filterable list of branches + recent commits.
 * Phase 3 K4 scaffold; tags will join in Phase 6 P7.
 */
export function JumpToRef({
  repoRoot,
  sessionId,
  onClose,
  onSelectBranch,
  onSelectCommit,
}: JumpToRefProps) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    listBranches(repoRoot)
      .then((b) => {
        if (!cancelled) {
          setBranches(b);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranches([]);
        }
      });
    gitLog(sessionId, 50, true)
      .then((c) => {
        if (!cancelled) {
          setCommits(c);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommits([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot, sessionId]);

  const entries: Entry[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedBranches: Entry[] = branches
      .filter((name) => !q || name.toLowerCase().includes(q))
      .map((name) => ({ kind: "branch", name }));
    const matchedCommits: Entry[] = commits
      .filter((c) => {
        if (!q) {
          return true;
        }
        const lower = q;

        return (
          c.subject.toLowerCase().includes(lower) ||
          c.hash.toLowerCase().startsWith(lower) ||
          c.abbreviatedHash.toLowerCase().startsWith(lower)
        );
      })
      .map((commit) => ({ kind: "commit", commit }));

    return [...matchedBranches, ...matchedCommits];
  }, [branches, commits, query]);

  // Clamp the highlight at render time when the filtered list shrinks below
  // the current cursor (per React 19 "no setState in effect" guidance).
  const cappedIndex = Math.min(activeIndex, Math.max(0, entries.length - 1));
  if (cappedIndex !== activeIndex) {
    setActiveIndex(cappedIndex);
  }

  const select = (entry: Entry) => {
    if (entry.kind === "branch") {
      onSelectBranch(entry.name);
    } else {
      onSelectCommit(entry.commit.hash);
    }
    onClose();
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) =>
        entries.length === 0 ? 0 : Math.min(i + 1, entries.length - 1),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = entries[activeIndex];
      if (entry) {
        select(entry);
      }
    }
  };

  // Keep the active row in view when the user paginates.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <Dialog
      onClose={onClose}
      size="medium"
      title="Jump to ref"
      titleId={titleId}
    >
      <div className={styles.body}>
        <Input
          autoFocus
          aria-label="Filter refs"
          placeholder="Search branches, commits…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
        />
        <ul ref={listRef} className={styles.list} role="listbox">
          {entries.length === 0 && <li className={styles.empty}>No matches</li>}
          {entries.map((entry, i) => {
            const active = i === activeIndex;

            return (
              <li
                key={
                  entry.kind === "branch"
                    ? `b:${entry.name}`
                    : `c:${entry.commit.hash}`
                }
                aria-selected={active}
                className={`${styles.row} ${active ? styles.rowActive : ""}`}
                data-row-index={i}
                role="option"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => select(entry)}
              >
                {entry.kind === "branch" ? (
                  <>
                    <Icons.BranchIcon size={12} />
                    <span className={styles.label}>{entry.name}</span>
                    <span className={styles.hint}>branch</span>
                  </>
                ) : (
                  <>
                    <Icons.ClockIcon size={12} />
                    <span className={styles.hash}>
                      {entry.commit.abbreviatedHash}
                    </span>
                    <span className={styles.label}>{entry.commit.subject}</span>
                  </>
                )}
              </li>
            );
          })}
          <li className={styles.tagsHint}>Tags coming in Phase 6</li>
        </ul>
      </div>
    </Dialog>
  );
}
