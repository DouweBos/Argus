import type { HierarchyNode } from "./types";
import { useMemo } from "react";
import { Icons } from "@argus/peacock";
import styles from "./HierarchySearch.module.css";
import { findSearchMatches } from "./resolveNodeVisual";
import {
  selectNode,
  setSearchQuery,
  useInspectionSelection,
  useSearchQuery,
} from "./store";

interface HierarchySearchProps {
  root: HierarchyNode;
}

/**
 * Search bar above the hierarchy tree. The query lives in the store so it
 * survives focus-mode changes and is visible to the tree renderer (for
 * highlighting + dimming). Enter / shift-Enter cycle through matches.
 */
export function HierarchySearch({ root }: HierarchySearchProps) {
  const query = useSearchQuery();
  const { selectedNodeId } = useInspectionSelection();

  const matches = useMemo(() => findSearchMatches(root, query), [root, query]);

  const activeIndex = useMemo(() => {
    if (matches.length === 0) {
      return -1;
    }
    const idx = matches.findIndex((m) => m.id === selectedNodeId);

    return idx;
  }, [matches, selectedNodeId]);

  const step = (dir: -1 | 1) => {
    if (matches.length === 0) {
      return;
    }
    let nextIdx: number;
    if (activeIndex < 0) {
      nextIdx = dir === 1 ? 0 : matches.length - 1;
    } else {
      nextIdx = (activeIndex + dir + matches.length) % matches.length;
    }
    selectNode(matches[nextIdx].id);
  };

  // On every keystroke, if there's at least one match and the current
  // selection isn't part of it, jump to the first match so the viewport
  // follows what the user typed. Runs in the change handler — no effect.
  const onQueryChange = (next: string) => {
    setSearchQuery(next);
    const hits = findSearchMatches(root, next);
    if (hits.length > 0 && !hits.some((h) => h.id === selectedNodeId)) {
      selectNode(hits[0].id);
    }
  };

  const hasQuery = query.length > 0;
  const displayIdx = activeIndex >= 0 ? activeIndex + 1 : 0;

  return (
    <div className={styles.root}>
      <div className={styles.field}>
        <span className={styles.searchIcon}>
          <Icons.SearchIcon size={12} />
        </span>
        <input
          className={styles.input}
          type="text"
          placeholder="Search hierarchy…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape" && hasQuery) {
              e.preventDefault();
              setSearchQuery("");
            }
          }}
        />
        {hasQuery && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => setSearchQuery("")}
            title="Clear search"
          >
            <Icons.CloseIcon size={10} />
          </button>
        )}
      </div>
      {hasQuery && (
        <>
          <span
            className={`${styles.count} ${matches.length > 0 ? styles.countActive : ""}`}
          >
            {matches.length === 0
              ? "no hits"
              : `${displayIdx} / ${matches.length}`}
          </span>
          <div className={styles.nav}>
            <button
              type="button"
              className={styles.navButton}
              disabled={matches.length === 0}
              onClick={() => step(-1)}
              title="Previous match (Shift+Enter)"
            >
              <Icons.ChevronUpIcon size={10} />
            </button>
            <button
              type="button"
              className={styles.navButton}
              disabled={matches.length === 0}
              onClick={() => step(1)}
              title="Next match (Enter)"
            >
              <Icons.ChevronDownIcon size={10} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
