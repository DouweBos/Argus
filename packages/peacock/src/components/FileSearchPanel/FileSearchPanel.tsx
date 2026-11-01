import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  SearchIcon,
} from "../../icons/Icons";
import { Spinner } from "../Spinner/Spinner";
import styles from "./FileSearchPanel.module.css";

export interface FileSearchOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

/** One match line, already split around the matched text. */
export interface FileSearchHit {
  key: string;
  /** 1-based. */
  line: number;
  before: string;
  match: string;
  after: string;
}

export interface FileSearchFileGroup {
  path: string;
  hits: FileSearchHit[];
}

export type FileSearchStatus =
  | { kind: "done"; count: number; truncated: boolean }
  | { kind: "failed"; message: string }
  | { kind: "idle" }
  | { kind: "running" };

export interface FileSearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  options: FileSearchOptions;
  onOptionsChange: (options: FileSearchOptions) => void;
  groups: FileSearchFileGroup[];
  status: FileSearchStatus;
  onOpenHit: (path: string, line: number) => void;
  /** Shown above the results, e.g. a banner when searching isn't allowed. */
  notice?: ReactNode;
  autoFocus?: boolean;
  disabled?: boolean;
}

const TOGGLES: {
  key: keyof FileSearchOptions;
  label: string;
  title: string;
}[] = [
  { key: "caseSensitive", label: "Aa", title: "Match case" },
  { key: "wholeWord", label: "ab", title: "Match whole word" },
  { key: "regex", label: ".*", title: "Use regular expression" },
];

function splitPath(path: string): { name: string; directory: string } {
  const slash = path.lastIndexOf("/");

  return slash === -1
    ? { name: path, directory: "" }
    : { name: path.slice(slash + 1), directory: path.slice(0, slash) };
}

function statusLine(status: FileSearchStatus, files: number): string | null {
  switch (status.kind) {
    case "idle":
      return null;
    case "running":
      return "Searching…";
    case "failed":
      return status.message;
    case "done": {
      if (status.count === 0) {
        return "No results";
      }
      const results = `${status.count}${status.truncated ? "+" : ""} result${status.count === 1 ? "" : "s"}`;

      return `${results} in ${files} file${files === 1 ? "" : "s"}${status.truncated ? " — showing the first ones" : ""}`;
    }
  }
}

/**
 * Search across a worktree: a query field with case / word / regex toggles,
 * and matches grouped by file as they stream in. Running the search is the
 * caller's; this only shows it.
 */
export function FileSearchPanel({
  query,
  onQueryChange,
  options,
  onOptionsChange,
  groups,
  status,
  onOpenHit,
  notice,
  autoFocus = false,
  disabled = false,
}: FileSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const line = statusLine(status, groups.length);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });

  return (
    <div className={styles.panel}>
      <div className={styles.bar}>
        <div className={styles.field}>
          <SearchIcon size={13} className={styles.fieldIcon} />
          <input
            ref={inputRef}
            aria-label="Search in files"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className={styles.input}
            disabled={disabled}
            enterKeyHint="search"
            placeholder="Search in files"
            spellCheck={false}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          {TOGGLES.map((t) => (
            <button
              key={t.key}
              aria-label={t.title}
              aria-pressed={options[t.key]}
              className={`${styles.toggle} ${options[t.key] ? styles.toggleOn : ""}`}
              disabled={disabled}
              title={t.title}
              type="button"
              onClick={() =>
                onOptionsChange({ ...options, [t.key]: !options[t.key] })
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        {line && (
          <div
            className={`${styles.status} ${status.kind === "failed" ? styles.statusError : ""}`}
            role="status"
          >
            {status.kind === "running" && <Spinner size="xs" />}
            {line}
          </div>
        )}
      </div>
      {notice}
      <div className={styles.results}>
        {groups.map((group) => {
          const { name, directory } = splitPath(group.path);
          const isCollapsed = collapsed.has(group.path);

          return (
            <section key={group.path} className={styles.group}>
              <button
                aria-expanded={!isCollapsed}
                className={styles.groupHead}
                title={group.path}
                type="button"
                onClick={() => toggle(group.path)}
              >
                {isCollapsed ? (
                  <ChevronRightIcon size={10} />
                ) : (
                  <ChevronDownIcon size={10} />
                )}
                <FileIcon size={12} className={styles.fileIcon} />
                <span className={styles.name}>{name}</span>
                {directory && (
                  <span className={styles.directory}>{directory}</span>
                )}
                <span className={styles.count}>{group.hits.length}</span>
              </button>
              {!isCollapsed &&
                group.hits.map((hit) => (
                  <button
                    key={hit.key}
                    className={styles.hit}
                    type="button"
                    onClick={() => onOpenHit(group.path, hit.line)}
                  >
                    <span className={styles.lineNumber}>{hit.line}</span>
                    <span className={styles.preview}>
                      {hit.before}
                      <mark className={styles.match}>{hit.match}</mark>
                      {hit.after}
                    </span>
                  </button>
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
