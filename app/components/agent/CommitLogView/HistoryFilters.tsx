/**
 * Phase 4 H3 — search bar + filters for the commit log.
 *
 * Filter values are owned by the parent (so they survive view switches via
 * `gitUiStore.historyFiltersBySession`); this component just renders inputs
 * and emits a debounced `LogFilter` whenever any field changes.
 */

import type { HistoryFilters as Filters } from "../../../stores/gitUiStore";
import { useEffect, useState } from "react";
import { Button, Icons, Input } from "@argus/peacock";
import { EMPTY_HISTORY_FILTERS } from "../../../stores/gitUiStore";
import styles from "./HistoryFilters.module.css";

export interface HistoryFiltersProps {
  authors: string[];
  branches: string[];
  /** Hide the branch picker — only useful in the all-branches History view. */
  hideBranch?: boolean;
  onChange: (filters: Filters) => void;
  value: Filters;
}

const REF_TYPES: Filters["refType"][] = ["all", "tags", "remotes", "locals"];

export function HistoryFilters({
  value,
  authors,
  branches,
  hideBranch,
  onChange,
}: HistoryFiltersProps) {
  // Debounce just the query field — other fields fire immediately.
  const [query, setQuery] = useState(value.query);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect --
       Sync local debounced state with parent prop on session/filter switches. */
    setQuery(value.query);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [value.query]);

  useEffect(() => {
    if (query === value.query) {
      return;
    }
    const t = setTimeout(() => onChange({ ...value, query }), 250);

    return () => clearTimeout(t);
  }, [query, value, onChange]);

  const update = (patch: Partial<Filters>): void => {
    onChange({ ...value, ...patch });
  };

  const isActive =
    query !== "" ||
    value.author !== "" ||
    value.branch !== "" ||
    value.since !== "" ||
    value.until !== "" ||
    value.refType !== "all";

  return (
    <div className={styles.bar}>
      <div className={styles.searchRow}>
        <Icons.SearchIcon size={12} />
        <Input
          value={query}
          placeholder="Search commits — supports path:foo, diff:bar, hash"
          onChange={(e) => setQuery(e.target.value)}
          className={styles.searchInput}
        />
      </div>
      <div className={styles.filtersRow}>
        <select
          aria-label="Filter by author"
          className={styles.select}
          value={value.author}
          onChange={(e) => update({ author: e.target.value })}
        >
          <option value="">All authors</option>
          {authors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          aria-label="From date"
          className={styles.dateInput}
          type="date"
          value={value.since}
          onChange={(e) => update({ since: e.target.value })}
        />
        <input
          aria-label="To date"
          className={styles.dateInput}
          type="date"
          value={value.until}
          onChange={(e) => update({ until: e.target.value })}
        />
        {!hideBranch && (
          <select
            aria-label="Filter by branch"
            className={styles.select}
            value={value.branch}
            onChange={(e) => update({ branch: e.target.value })}
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
        <div className={styles.chips}>
          {REF_TYPES.map((rt) => (
            <button
              key={rt}
              type="button"
              className={`${styles.chip} ${value.refType === rt ? styles.chipActive : ""}`}
              onClick={() => update({ refType: rt })}
            >
              {rt}
            </button>
          ))}
        </div>
        {isActive && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(EMPTY_HISTORY_FILTERS)}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
