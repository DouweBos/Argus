import type {
  ChatHistoryEntry,
  ChatHistoryMessageMatch,
  ChatHistorySearchResult,
} from "../../../lib/chatHistory";
import { useEffect, useMemo, useState } from "react";
import { Button, Eyebrow, Icons, Input } from "@argus/peacock";
import { searchChatHistory } from "../../../lib/ipc";
import styles from "./ChatHistoryList.module.css";

const DEFAULT_LIMIT = 10;
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

function formatCost(cost?: number): string | null {
  if (cost == null || cost <= 0) {
    return null;
  }

  return `$${cost.toFixed(2)}`;
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
  onView: (historyId: string) => void;
}

function EntryRow({
  entry,
  matches,
  onView,
  onResume,
  onDelete,
}: EntryRowProps) {
  const cost = formatCost(entry.totalCost);

  return (
    <div className={styles.entry} onClick={() => onView(entry.id)}>
      <span className={styles.entryTitle}>{entry.title}</span>
      <div className={styles.entryMeta}>
        <span>{formatRelativeDate(entry.endedAt)}</span>
        <span className={styles.dot} />
        <span>{entry.sessionBranch}</span>
        {entry.model && (
          <>
            <span className={styles.dot} />
            <span>{entry.model}</span>
          </>
        )}
        {cost && (
          <>
            <span className={styles.dot} />
            <span>{cost}</span>
          </>
        )}
        <span className={styles.dot} />
        <span>
          {entry.messageCount} msg{entry.messageCount !== 1 ? "s" : ""}
        </span>
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
        <Button
          variant="ghost"
          size="sm"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(entry.id);
          }}
        >
          <Icons.CloseIcon size={10} />
        </Button>
      </div>
    </div>
  );
}

interface ChatHistoryListProps {
  entries: ChatHistoryEntry[];
  onClearAll?: () => void;
  onDelete: (historyId: string) => void;
  onResume: (sessionId: string) => void;
  onView: (historyId: string) => void;
  repoRoot: string | null;
}

export function ChatHistoryList({
  entries,
  repoRoot,
  onView,
  onResume,
  onDelete,
  onClearAll,
}: ChatHistoryListProps) {
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<{
    query: string;
    results: ChatHistorySearchResult[] | null;
    searching: boolean;
  }>({ query: "", results: null, searching: false });

  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed || !repoRoot) {
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
      searchChatHistory(repoRoot, trimmed)
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
  }, [trimmed, repoRoot]);

  const effectiveResults =
    trimmed && searchState.query === trimmed ? searchState.results : null;
  const effectiveSearching =
    trimmed && (searchState.query !== trimmed || searchState.searching);

  const visibleEntries = useMemo(
    () => (!trimmed ? entries.slice(0, DEFAULT_LIMIT) : []),
    [entries, trimmed],
  );

  const hiddenCount = !trimmed ? entries.length - visibleEntries.length : 0;

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Eyebrow>Recent Sessions</Eyebrow>
        <div className={styles.headerActions}>
          <div className={styles.searchWrap}>
            <Icons.SearchIcon size={12} className={styles.searchIcon} />
            <Input
              bare
              type="search"
              placeholder="Search chats & messages"
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
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
              <Icons.TrashIcon size={12} />
            </button>
          )}
        </div>
      </div>

      {!trimmed &&
        visibleEntries.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            matches={[]}
            onDelete={onDelete}
            onResume={onResume}
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
            onView={onView}
          />
        ))}

      {!trimmed && hiddenCount > 0 && (
        <div className={styles.moreHint}>
          {hiddenCount} more — search to find them
        </div>
      )}
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
  );
}
