import type {
  ChatHistoryEntry,
  ChatHistoryMessageMatch,
  ChatHistorySearchResult,
} from "@argus/remote-protocol";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CloseIcon, PinIcon, SearchIcon, TrashIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { Input } from "../Input/Input";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import styles from "./ChatHistoryList.module.css";

/** Search hits across saved chats; resolves to the matching entries with their message snippets. */
export type ChatHistorySearch = (
  query: string,
) => Promise<ChatHistorySearchResult[]>;

const SEARCH_DEBOUNCE_MS = 120;

function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function roleLabel(role: ChatHistoryMessageMatch["role"]): string {
  if (role === "user") {
    return "You";
  }
  if (role === "assistant") {
    return "Assistant";
  }

  return "System";
}

function HighlightedSnippet({ match }: { match: ChatHistoryMessageMatch }) {
  const { snippet, matchStart, matchEnd } = match;
  if (matchStart === matchEnd) {
    return <span className={styles.snippetText}>{snippet}</span>;
  }

  return (
    <span className={styles.snippetText}>
      {snippet.slice(0, matchStart)}
      <mark className={styles.snippetHit}>
        {snippet.slice(matchStart, matchEnd)}
      </mark>
      {snippet.slice(matchEnd)}
    </span>
  );
}

interface EntryRowProps {
  entry: ChatHistoryEntry;
  matches: ChatHistoryMessageMatch[];
  onDelete: (historyId: string) => void;
  onResume: (sessionId: string) => void;
  onSetPinned?: (historyId: string, pinned: boolean) => void;
  onView: (historyId: string) => void;
}

function EntryRow({
  entry,
  matches,
  onView,
  onResume,
  onDelete,
  onSetPinned,
}: EntryRowProps) {
  return (
    <div className={styles.entry} onClick={() => onView(entry.id)}>
      <span className={styles.entryTitle}>
        {entry.pinned && (
          <span
            aria-label="Pinned"
            className={styles.pinMark}
            title="Pinned: resumed when Argus restarts"
          >
            <PinIcon size={10} />
          </span>
        )}
        {entry.title}
      </span>
      <div className={styles.entryMeta}>
        <span>{formatRelativeDate(entry.endedAt)}</span>
        <span className={styles.dot} />
        <span>{entry.sessionBranch}</span>
        <span className={styles.dot} />
        <span>
          {entry.messageCount} msg{entry.messageCount !== 1 ? "s" : ""}
        </span>
        {entry.importedFrom === "claude_code" && (
          <Badge size="tag" title="Imported · Claude Code" tone="neutral">
            Imported
          </Badge>
        )}
      </div>
      {matches.length > 0 && (
        <div className={styles.snippets}>
          {matches.map((match, idx) => (
            <div
              key={`${match.messageIndex}-${idx}`}
              className={styles.snippet}
            >
              <span className={styles.snippetRole}>
                {roleLabel(match.role)}
              </span>
              <HighlightedSnippet match={match} />
            </div>
          ))}
        </div>
      )}
      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          title="Resume this session"
          onClick={(e) => {
            e.stopPropagation();
            onResume(entry.sessionId);
          }}
        >
          Resume
        </Button>
        {onSetPinned && !entry.importedFrom && (
          <Button
            variant="ghost"
            size="sm"
            title={
              entry.pinned
                ? "Unpin: stop resuming it when Argus restarts"
                : "Pin: resume it when Argus restarts"
            }
            onClick={(e) => {
              e.stopPropagation();
              onSetPinned(entry.id, !entry.pinned);
            }}
          >
            {entry.pinned ? "Unpin" : "Pin"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(entry.id);
          }}
        >
          <CloseIcon size={10} />
        </Button>
      </div>
    </div>
  );
}

export interface ChatHistoryListProps {
  entries: ChatHistoryEntry[];
  meta: string;
  onClearAll?: () => void;
  onDelete: (historyId: string) => void;
  /** Called with the entry's runner session id. */
  onResume: (sessionId: string) => void;
  onSetPinned?: (historyId: string, pinned: boolean) => void;
  onView: (historyId: string) => void;
  /** Searches titles and message text; omit to hide the search field. */
  search?: ChatHistorySearch;
  title: string;
}

export function ChatHistoryList({
  entries,
  title,
  meta,
  search,
  onView,
  onResume,
  onDelete,
  onClearAll,
  onSetPinned,
}: ChatHistoryListProps) {
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<{
    query: string;
    results: ChatHistorySearchResult[] | null;
    searching: boolean;
  }>({ query: "", results: null, searching: false });

  const trimmed = query.trim();
  // Callers pass a fresh closure each render; a search only restarts on a new query.
  const searchRef = useRef(search);
  useLayoutEffect(() => {
    searchRef.current = search;
  });
  const canSearch = !!search;

  useEffect(() => {
    const run = searchRef.current;
    if (!trimmed || !run) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setSearchState((prev) =>
        prev.query === trimmed && prev.searching
          ? prev
          : {
              query: trimmed,
              results: prev.query === trimmed ? prev.results : null,
              searching: true,
            },
      );
      run(trimmed)
        .then((results) => {
          if (cancelled) {
            return;
          }
          setSearchState({ query: trimmed, results, searching: false });
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          setSearchState({ query: trimmed, results: [], searching: false });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, canSearch]);

  const effectiveResults =
    trimmed && searchState.query === trimmed ? searchState.results : null;
  const effectiveSearching =
    trimmed && (searchState.query !== trimmed || searchState.searching);

  const visibleEntries = useMemo(
    () => (!trimmed ? entries : []),
    [entries, trimmed],
  );

  if (entries.length === 0) {
    return null;
  }

  const action = (
    <div className={styles.headerActions}>
      {search && (
        <div className={styles.searchWrap}>
          <SearchIcon size={12} className={styles.searchIcon} />
          <Input
            bare
            aria-label="Search chats"
            type="search"
            placeholder="Search chats & messages"
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {onClearAll && (
        <button
          className={styles.clearAll}
          title="Clear all chats"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClearAll();
          }}
        >
          <TrashIcon size={12} />
        </button>
      )}
    </div>
  );

  return (
    <SectionPanel title={title} meta={meta} action={action}>
      <div className={styles.container}>
        {!trimmed &&
          visibleEntries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              matches={[]}
              onDelete={onDelete}
              onResume={onResume}
              onSetPinned={onSetPinned}
              onView={onView}
            />
          ))}

        {trimmed &&
          effectiveResults?.map((result) => (
            <EntryRow
              key={result.entry.id}
              entry={result.entry}
              matches={result.messageMatches}
              onDelete={onDelete}
              onResume={onResume}
              onSetPinned={onSetPinned}
              onView={onView}
            />
          ))}

        {trimmed && effectiveSearching && !effectiveResults && (
          <div className={styles.moreHint}>Searching…</div>
        )}
        {trimmed &&
          !effectiveSearching &&
          effectiveResults &&
          effectiveResults.length === 0 && (
            <div className={styles.moreHint}>
              No chats match &ldquo;{query}&rdquo;
            </div>
          )}
      </div>
    </SectionPanel>
  );
}
