import type { GitCommit } from "../../../lib/ipc";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../HistoryView/HistoryView.module.css";

export interface UseCommitSelectionResult {
  extendSelection: (idx: number, mode: "range" | "toggle") => Promise<void>;
  handleCommitClick: (e: React.MouseEvent, i: number) => void;
  handleCommitMouseDown: (e: React.MouseEvent) => void;
  selectCommit: (idx: number) => Promise<void>;
  selectedHashes: Set<string>;
  selectedIdx: number;
  selectedIndices: number[];
  setSelectedHashes: React.Dispatch<React.SetStateAction<Set<string>>>;
  visibleSelectedHashes: Set<string>;
}

/**
 * Manages commit list selection state, keyboard navigation, and multi-select
 * behaviour (range, toggle, cmd-A).
 */
export function useCommitSelection(
  commits: GitCommit[],
  listRef: React.RefObject<HTMLDivElement | null>,
  onLoadDiff: (commit: GitCommit) => Promise<void>,
  onClearDiff: () => void,
): UseCommitSelectionResult {
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(
    () => new Set(),
  );
  // Anchor (pivot) for keyboard / shift-click range extension. Plain click,
  // cmd-click, and arrow navigation reset both pivot and head to the active
  // row. Shift-click / shift-arrow only moves the head; pivot stays put.
  const pivotIdxRef = useRef<number>(-1);
  const headIdxRef = useRef<number>(-1);

  const focusCommitRow = useCallback(
    (idx: number) => {
      const node = listRef.current?.querySelectorAll(`.${styles.commitItem}`)[
        idx
      ] as HTMLElement | undefined;
      node?.focus();
      node?.scrollIntoView({ block: "nearest" });
    },
    [listRef],
  );

  const selectCommit = useCallback(
    async (idx: number) => {
      setSelectedIdx(idx);
      const commit = commits[idx];
      if (!commit) {
        setSelectedHashes(new Set());

        return;
      }
      setSelectedHashes(new Set([commit.hash]));
      pivotIdxRef.current = idx;
      headIdxRef.current = idx;
      await onLoadDiff(commit);
    },
    [commits, onLoadDiff],
  );

  const extendSelection = useCallback(
    async (idx: number, mode: "range" | "toggle") => {
      const commit = commits[idx];
      if (!commit) {
        return;
      }
      if (mode === "range") {
        let pivot = pivotIdxRef.current;
        if (pivot < 0) {
          pivot = selectedIdx >= 0 ? selectedIdx : idx;
        }
        const lo = Math.min(pivot, idx);
        const hi = Math.max(pivot, idx);
        const next = new Set<string>();
        for (let k = lo; k <= hi; k++) {
          const c = commits[k];
          if (c) {
            next.add(c.hash);
          }
        }
        setSelectedHashes(next);
        headIdxRef.current = idx;
      } else {
        const wasSelected = selectedHashes.has(commit.hash);
        const next = new Set(selectedHashes);
        if (wasSelected) {
          next.delete(commit.hash);
        } else {
          next.add(commit.hash);
        }
        setSelectedHashes(next);
        if (wasSelected) {
          // Deselect: pick a remaining hash as active (or clear if none left).
          let fallbackIdx = -1;
          if (next.size > 0) {
            for (let k = 0; k < commits.length; k++) {
              const c = commits[k];
              if (c && next.has(c.hash)) {
                fallbackIdx = k;
                break;
              }
            }
          }
          setSelectedIdx(fallbackIdx);
          pivotIdxRef.current = fallbackIdx;
          headIdxRef.current = fallbackIdx;
          const fallback = fallbackIdx >= 0 ? commits[fallbackIdx] : undefined;
          if (fallback) {
            await onLoadDiff(fallback);
          } else {
            onClearDiff();
          }

          return;
        }
        pivotIdxRef.current = idx;
        headIdxRef.current = idx;
      }
      setSelectedIdx(idx);
      await onLoadDiff(commit);
    },
    [commits, onLoadDiff, onClearDiff, selectedHashes, selectedIdx],
  );

  // Arrow / shift-arrow / cmd-A keyboard navigation. Bound to the list
  // container in capture mode so a focused commit-row button can't swallow
  // the event before we see it.
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const len = commits.length;
      if (len === 0) {
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const lastIdx = len - 1;

        if (e.shiftKey) {
          let pivot = pivotIdxRef.current;
          if (pivot < 0) {
            pivot = selectedIdx >= 0 ? selectedIdx : 0;
            pivotIdxRef.current = pivot;
          }
          let head = headIdxRef.current;
          if (head < 0) {
            head = pivot;
          }
          const newHead = Math.max(0, Math.min(head + delta, lastIdx));
          headIdxRef.current = newHead;
          const lo = Math.min(pivot, newHead);
          const hi = Math.max(pivot, newHead);
          const next = new Set<string>();
          for (let k = lo; k <= hi; k++) {
            const c = commits[k];
            if (c) {
              next.add(c.hash);
            }
          }
          setSelectedHashes(next);
          setSelectedIdx(newHead);
          const c = commits[newHead];
          if (c) {
            onLoadDiff(c).catch(() => undefined);
          }
          focusCommitRow(newHead);
        } else {
          const cur = selectedIdx >= 0 ? selectedIdx : 0;
          const newRow = Math.max(0, Math.min(cur + delta, lastIdx));
          pivotIdxRef.current = newRow;
          headIdxRef.current = newRow;
          const c = commits[newRow];
          if (c) {
            setSelectedHashes(new Set([c.hash]));
            setSelectedIdx(newRow);
            onLoadDiff(c).catch(() => undefined);
          }
          focusCommitRow(newRow);
        }
      } else if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "a" || e.key === "A" || e.code === "KeyA")
      ) {
        e.preventDefault();
        e.stopPropagation();
        const all = new Set(commits.map((c) => c.hash));
        setSelectedHashes(all);
        pivotIdxRef.current = 0;
        headIdxRef.current = len - 1;
      }
    };

    list.addEventListener("keydown", handleKeyDown, true);

    return () => list.removeEventListener("keydown", handleKeyDown, true);
  }, [commits, focusCommitRow, onLoadDiff, selectedIdx, listRef]);

  // Prune hashes that are no longer in the visible commit list (filters,
  // pagination, session swap). Derived state during render — no effect needed.
  const visibleSelectedHashes = useMemo(() => {
    if (selectedHashes.size === 0) {
      return selectedHashes;
    }
    const valid = new Set(commits.map((c) => c.hash));
    let changed = false;
    const next = new Set<string>();
    for (const h of selectedHashes) {
      if (valid.has(h)) {
        next.add(h);
      } else {
        changed = true;
      }
    }

    return changed ? next : selectedHashes;
  }, [commits, selectedHashes]);

  const selectedIndices = useMemo(() => {
    if (visibleSelectedHashes.size === 0) {
      return [] as number[];
    }
    const out: number[] = [];
    commits.forEach((c, i) => {
      if (visibleSelectedHashes.has(c.hash)) {
        out.push(i);
      }
    });

    return out;
  }, [commits, visibleSelectedHashes]);

  const handleCommitClick = useCallback(
    (e: React.MouseEvent, i: number) => {
      if (e.shiftKey) {
        e.preventDefault();
        extendSelection(i, "range").catch(() => undefined);
      } else if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        extendSelection(i, "toggle").catch(() => undefined);
      } else {
        selectCommit(i).catch(() => undefined);
      }
    },
    [extendSelection, selectCommit],
  );

  // Range selections via shift-click can otherwise highlight text in the row.
  const handleCommitMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
    }
  }, []);

  return {
    extendSelection,
    handleCommitClick,
    handleCommitMouseDown,
    selectCommit,
    selectedHashes,
    selectedIdx,
    selectedIndices,
    setSelectedHashes,
    visibleSelectedHashes,
  };
}
