import type { RefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icons, Input } from "@argus/peacock";
import styles from "./ChatSearchBar.module.css";

const HIGHLIGHT_NAME = "chat-search";
const ACTIVE_HIGHLIGHT_NAME = "chat-search-active";
const DEBOUNCE_MS = 80;

type HighlightRegistry = Map<string, Highlight>;
type HighlightCtor = new (...ranges: AbstractRange[]) => Highlight;

function getHighlightRegistry(): HighlightRegistry | null {
  if (typeof CSS === "undefined") {
    return null;
  }
  const css = CSS as unknown as { highlights?: HighlightRegistry };

  return css.highlights ?? null;
}

function getHighlightCtor(): HighlightCtor | null {
  const ctor = (globalThis as unknown as { Highlight?: HighlightCtor })
    .Highlight;

  return ctor ?? null;
}

function clearHighlights() {
  const reg = getHighlightRegistry();
  if (!reg) {
    return;
  }
  reg.delete(HIGHLIGHT_NAME);
  reg.delete(ACTIVE_HIGHLIGHT_NAME);
}

function collectRanges(container: HTMLElement, query: string): Range[] {
  if (!query) {
    return [];
  }
  const needle = query.toLowerCase();
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || node.nodeValue.length === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!node.parentElement) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null = walker.nextNode();
  while (node) {
    const text = node.nodeValue ?? "";
    const haystack = text.toLowerCase();
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) {
        break;
      }
      const range = document.createRange();
      try {
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        ranges.push(range);
      } catch {
        // Range construction can fail if the DOM mutates during the walk.
      }
      from = idx + needle.length;
    }
    node = walker.nextNode();
  }

  return ranges;
}

function scrollRangeIntoView(range: Range, container: HTMLElement) {
  const rect = range.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const margin = 60;
  if (
    rect.top < containerRect.top + margin ||
    rect.bottom > containerRect.bottom - margin
  ) {
    const target =
      container.scrollTop +
      (rect.top - containerRect.top) -
      container.clientHeight / 2 +
      rect.height / 2;
    container.scrollTo({ top: target, behavior: "smooth" });
  }
}

/** Convert each range to a normalised vertical position (0..1) within the
 *  container's scrollable content. */
function computeTickPositions(
  ranges: Range[],
  container: HTMLElement,
): number[] {
  const containerRect = container.getBoundingClientRect();
  const totalHeight = container.scrollHeight;
  if (totalHeight <= 0) {
    return ranges.map(() => 0);
  }

  return ranges.map((range) => {
    const rect = range.getBoundingClientRect();
    const scrollTopOfMatch =
      rect.top - containerRect.top + container.scrollTop + rect.height / 2;

    return Math.max(0, Math.min(1, scrollTopOfMatch / totalHeight));
  });
}

interface ChatSearchBarProps {
  containerRef: RefObject<HTMLDivElement | null>;
  messagesVersion: number;
  onClose: () => void;
}

export function ChatSearchBar({
  containerRef,
  messagesVersion,
  onClose,
}: ChatSearchBarProps) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [tickPositions, setTickPositions] = useState<number[]>([]);
  const [minimapBounds, setMinimapBounds] = useState<{
    height: number;
    top: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rangesRef = useRef<Range[]>([]);
  const supported = useMemo(
    () => getHighlightRegistry() !== null && getHighlightCtor() !== null,
    [],
  );

  // Focus input on mount.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Track the messages container's position within its offsetParent so the
  // minimap overlay can align to it. The offsetParent here is the `.chat`
  // container (position: relative) — we position the minimap inside that.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const update = () => {
      setMinimapBounds({
        top: container.offsetTop,
        height: container.offsetHeight,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    const parent = container.offsetParent;
    if (parent instanceof HTMLElement) {
      observer.observe(parent);
    }

    return () => observer.disconnect();
  }, [containerRef]);

  // Rebuild highlights and tick positions when query or messages change.
  // All state updates run inside the debounced timer so the effect body
  // itself stays side-effect-free with respect to React state.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const container = containerRef.current;
      const registry = getHighlightRegistry();
      const HighlightCtor = getHighlightCtor();
      if (!container || !registry || !HighlightCtor) {
        rangesRef.current = [];
        setMatchCount(0);
        setTickPositions([]);

        return;
      }

      const trimmed = query.trim();
      if (!trimmed) {
        rangesRef.current = [];
        setMatchCount(0);
        setActiveIndex(0);
        setTickPositions([]);
        registry.delete(HIGHLIGHT_NAME);
        registry.delete(ACTIVE_HIGHLIGHT_NAME);

        return;
      }

      const ranges = collectRanges(container, trimmed);
      rangesRef.current = ranges;
      setMatchCount(ranges.length);
      setActiveIndex((prev) => {
        if (ranges.length === 0) {
          return 0;
        }

        return Math.min(prev, ranges.length - 1);
      });

      if (ranges.length === 0) {
        setTickPositions([]);
        registry.delete(HIGHLIGHT_NAME);
        registry.delete(ACTIVE_HIGHLIGHT_NAME);

        return;
      }

      registry.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges));
      setTickPositions(computeTickPositions(ranges, container));
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [query, messagesVersion, containerRef]);

  // Update the active-match highlight and scroll it into view.
  useEffect(() => {
    const registry = getHighlightRegistry();
    const HighlightCtor = getHighlightCtor();
    const container = containerRef.current;
    if (!registry || !HighlightCtor || !container) {
      return;
    }
    const ranges = rangesRef.current;
    if (ranges.length === 0) {
      registry.delete(ACTIVE_HIGHLIGHT_NAME);

      return;
    }
    const active = ranges[activeIndex];
    if (!active) {
      registry.delete(ACTIVE_HIGHLIGHT_NAME);

      return;
    }
    registry.set(ACTIVE_HIGHLIGHT_NAME, new HighlightCtor(active));
    scrollRangeIntoView(active, container);
  }, [activeIndex, matchCount, containerRef]);

  // Clear highlights when the bar unmounts.
  useEffect(() => {
    return () => clearHighlights();
  }, []);

  const gotoNext = useCallback(() => {
    setActiveIndex((prev) => {
      if (rangesRef.current.length === 0) {
        return 0;
      }

      return (prev + 1) % rangesRef.current.length;
    });
  }, []);

  const gotoPrev = useCallback(() => {
    setActiveIndex((prev) => {
      const count = rangesRef.current.length;
      if (count === 0) {
        return 0;
      }

      return (prev - 1 + count) % count;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();

        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          gotoPrev();
        } else {
          gotoNext();
        }
      }
    },
    [gotoNext, gotoPrev, onClose],
  );

  const trimmedQuery = query.trim();
  let counter = "";
  if (trimmedQuery) {
    counter =
      matchCount === 0 ? "No matches" : `${activeIndex + 1} of ${matchCount}`;
  }

  return (
    <>
      <div className={styles.bar} role="search">
        <div className={styles.inputWrap}>
          <Icons.SearchIcon size={12} className={styles.searchIcon} />
          <Input
            ref={inputRef}
            bare
            type="search"
            placeholder={
              supported ? "Find in chat" : "Find in chat (unsupported)"
            }
            aria-label="Find in chat"
            className={styles.input}
            value={query}
            disabled={!supported}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <span
          className={`${styles.counter} ${
            trimmedQuery && matchCount === 0 ? styles.counterEmpty : ""
          }`}
        >
          {counter}
        </span>
        <button
          type="button"
          className={styles.navButton}
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          disabled={matchCount === 0}
          onClick={gotoPrev}
        >
          <Icons.ChevronUpIcon size={12} />
        </button>
        <button
          type="button"
          className={styles.navButton}
          aria-label="Next match"
          title="Next match (Enter)"
          disabled={matchCount === 0}
          onClick={gotoNext}
        >
          <Icons.ChevronDownIcon size={12} />
        </button>
        <button
          type="button"
          className={styles.navButton}
          aria-label="Close search"
          title="Close (Esc)"
          onClick={onClose}
        >
          <Icons.CloseIcon size={10} />
        </button>
      </div>

      {minimapBounds && tickPositions.length > 0 && (
        <div
          aria-hidden="true"
          className={styles.minimap}
          style={{ top: minimapBounds.top, height: minimapBounds.height }}
        >
          {tickPositions.map((pct, idx) => (
            <button
              key={idx}
              type="button"
              tabIndex={-1}
              className={`${styles.tick} ${
                idx === activeIndex ? styles.tickActive : ""
              }`}
              style={{ top: `${pct * 100}%` }}
              title={`Match ${idx + 1} of ${tickPositions.length}`}
              onClick={() => setActiveIndex(idx)}
            />
          ))}
        </div>
      )}
    </>
  );
}
