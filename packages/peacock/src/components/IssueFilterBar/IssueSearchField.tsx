import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "../../icons/Icons";
import { Input } from "../Input/Input";
import styles from "./IssueFilterBar.module.css";

const DEBOUNCE_MS = 300;

export interface IssueSearchFieldProps {
  /**
   * The settled term (trimmed; "" when cleared). `replace` is true when it
   * refines a search already under way, so it can replace that history entry.
   */
  onSearch: (term: string, replace: boolean) => void;
  placeholder?: string;
  /** The searched term, null when not searching. */
  query: string | null;
}

/** Searches every issue in the workspace, once typing settles. */
export function IssueSearchField({
  onSearch,
  placeholder = "Search all issues…",
  query,
}: IssueSearchFieldProps) {
  const [text, setText] = useState(query ?? "");
  const searching = useRef(query !== null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );

  const settle = (value: string) => {
    const term = value.trim();
    if (term) {
      onSearch(term, searching.current);
      searching.current = true;
    } else if (searching.current) {
      onSearch("", true);
      searching.current = false;
    }
  };

  return (
    <label className={styles.search}>
      <SearchIcon size={12} />
      <Input
        bare
        aria-label="Search all issues"
        placeholder={placeholder}
        type="search"
        value={text}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          if (timer.current !== null) {
            window.clearTimeout(timer.current);
          }
          timer.current = window.setTimeout(() => settle(value), DEBOUNCE_MS);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            setText("");
            settle("");
          }
        }}
      />
    </label>
  );
}
