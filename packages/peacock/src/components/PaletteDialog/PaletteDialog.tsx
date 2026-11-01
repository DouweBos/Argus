import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { SearchIcon } from "../../icons/Icons";
import { useDismissOnEscape } from "../../lib/modalStack";
import { HighlightedText } from "../HighlightedText/HighlightedText";
import { Kbd } from "../Kbd/Kbd";
import { Spinner } from "../Spinner/Spinner";
import styles from "./PaletteDialog.module.css";

export interface PaletteItem {
  id: string;
  title: string;
  /** Offsets into `title` to highlight (fuzzy-matched letters). */
  titleMatches?: readonly number[];
  sublabel?: string;
  sublabelMatches?: readonly number[];
  icon?: ReactNode;
  /** Keys shown at the row's end. */
  hint?: string[];
  /** A trailing tag, e.g. "changed". */
  badge?: ReactNode;
}

export interface PaletteGroup {
  key: string;
  /** Omit for a flat list. */
  label?: string;
  items: PaletteItem[];
}

export interface PaletteDialogProps {
  ariaLabel: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  groups: PaletteGroup[];
  onSelect: (item: PaletteItem) => void;
  onClose: () => void;
  /** Shown instead of results while they load. */
  loading?: boolean;
  /** Shown when no group has items. */
  emptyLabel?: ReactNode;
}

/**
 * A modal search-and-pick list, the shell of the open and quick-open
 * palettes: a query field, grouped rows, arrow keys and Enter to pick, Escape
 * or a click outside to close. Filtering is the caller's.
 */
export function PaletteDialog({
  ariaLabel,
  placeholder,
  query,
  onQueryChange,
  groups,
  onSelect,
  onClose,
  loading = false,
  emptyLabel = "No matches.",
}: PaletteDialogProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  useDismissOnEscape(onClose);

  const ordered = groups.flatMap((g) => g.items);
  const safeIndex = Math.min(Math.max(activeIndex, 0), ordered.length - 1);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [safeIndex]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(Math.min(safeIndex + 1, ordered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(safeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = ordered[safeIndex];
      if (pick) {
        onSelect(pick);
      }
    }
  };

  const indexOf = new Map(ordered.map((it, i) => [it.id, i]));

  return (
    <div
      className={styles.overlay}
      onClick={onOverlayClick}
      role="presentation"
    >
      <div
        aria-label={ariaLabel}
        aria-modal="true"
        className={styles.palette}
        role="dialog"
      >
        <div className={styles.searchRow}>
          <SearchIcon size={14} />
          <input
            ref={inputRef}
            aria-label={ariaLabel}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className={styles.input}
            placeholder={placeholder}
            spellCheck={false}
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <Kbd keys={["esc"]} />
        </div>

        <div className={styles.results} role="listbox" aria-label={ariaLabel}>
          {(loading || ordered.length === 0) && (
            <div className={styles.empty}>
              {loading ? <Spinner size="sm" /> : emptyLabel}
            </div>
          )}
          {!loading &&
            groups
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <div key={g.key} className={styles.group}>
                  {g.label && <div className={styles.groupHead}>{g.label}</div>}
                  {g.items.map((it) => {
                    const index = indexOf.get(it.id) ?? -1;
                    const active = index === safeIndex;

                    return (
                      <button
                        key={it.id}
                        ref={active ? activeItemRef : undefined}
                        aria-selected={active}
                        className={`${styles.item} ${active ? styles.itemActive : ""}`}
                        role="option"
                        type="button"
                        onClick={() => onSelect(it)}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        {it.icon && (
                          <span className={styles.itemIcon}>{it.icon}</span>
                        )}
                        <span className={styles.itemText}>
                          <HighlightedText
                            className={styles.itemTitle}
                            indices={it.titleMatches}
                            text={it.title}
                          />
                          {it.sublabel && (
                            <HighlightedText
                              className={styles.itemSub}
                              indices={it.sublabelMatches}
                              text={it.sublabel}
                            />
                          )}
                        </span>
                        {it.badge}
                        {it.hint && <Kbd keys={it.hint} />}
                      </button>
                    );
                  })}
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
