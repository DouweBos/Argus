import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronUpIcon, ChevronDownIcon, CloseIcon } from "./Icons";
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
      if (val) onNext(val);
    },
    [onNext],
  );

  return (
    <div className={styles.bar}>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Find…"
        spellCheck={false}
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
        className={styles.btn}
        onClick={() => onPrevious(query)}
        disabled={!query || resultCount === 0}
        title="Previous (Shift+Enter)"
        aria-label="Previous match"
      >
        <ChevronUpIcon />
      </button>
      <button
        className={styles.btn}
        onClick={() => onNext(query)}
        disabled={!query || resultCount === 0}
        title="Next (Enter)"
        aria-label="Next match"
      >
        <ChevronDownIcon />
      </button>
      <button
        className={styles.btn}
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close search"
      >
        <CloseIcon size={10} />
      </button>
    </div>
  );
}
