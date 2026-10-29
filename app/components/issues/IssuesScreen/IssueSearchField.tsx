import { useEffect, useRef, useState } from "react";
import { Icons, Input } from "@argus/peacock";
import { appNavigate } from "../../../lib/router";
import styles from "./IssuesScreen.module.css";

const DEBOUNCE_MS = 300;

interface IssueSearchFieldProps {
  /** The searched term in the URL, null when not searching. */
  query: string | null;
}

/** Searches every issue in the workspace; the term lives in `/issues/search?q=`. */
export function IssueSearchField({ query }: IssueSearchFieldProps) {
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
      // The first term is a navigation; refining it replaces that entry.
      appNavigate(
        {
          view: "issues",
          issueScope: "search",
          issueRef: null,
          issueQuery: term,
        },
        { replace: searching.current },
      );
      searching.current = true;
    } else if (searching.current) {
      appNavigate(
        { view: "issues", issueScope: "assigned", issueRef: null },
        { replace: true },
      );
      searching.current = false;
    }
  };

  return (
    <label className={styles.search}>
      <Icons.SearchIcon size={12} />
      <Input
        bare
        aria-label="Search all issues"
        placeholder="Search all issues…"
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
