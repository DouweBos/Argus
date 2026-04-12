import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "../Icons";
import styles from "./TerminalSearchBar.module.css";

interface TerminalSearchBarProps {
  onClose: () => void;
  onNext: (query: string) => void;
  onPrevious: (query: string) => void;
  resultCount: number;
  resultIndex: number;
}

export function TerminalSearchBar({
  resultIndex,
  resultCount,
  onNext,
  onPrevious,
  onClose,
}: TerminalSearchBarProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        if (e.shiftKey) {
          onPrevious(query);
        } else {
          onNext(query);
        }
      }
    },
    [query, onNext, onPrevious, onClose],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setQuery(val);
      if (val) {
        onNext(val);
      }
    },
    [onNext],
  );

  return (
    <div className={styles.bar}>
      <input
        ref={inputRef}
        className={styles.input}
        placeholder="Find…"
        spellCheck={false}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {query && (
        <span
          className={`${styles.resultCount} ${resultCount === 0 ? styles.noResults : ""}`}
        >
          {resultCount === 0
            ? "No results"
            : `${resultIndex >= 0 ? resultIndex + 1 : "?"} of ${resultCount}`}
        </span>
      )}
      <button
        aria-label="Previous match"
        className={styles.btn}
        disabled={!query || resultCount === 0}
        title="Previous (Shift+Enter)"
        onClick={() => onPrevious(query)}
      >
        <ChevronUpIcon />
      </button>
      <button
        aria-label="Next match"
        className={styles.btn}
        disabled={!query || resultCount === 0}
        title="Next (Enter)"
        onClick={() => onNext(query)}
      >
        <ChevronDownIcon />
      </button>
      <button
        aria-label="Close search"
        className={styles.btn}
        title="Close (Esc)"
        onClick={onClose}
      >
        <CloseIcon size={10} />
      </button>
    </div>
  );
}
