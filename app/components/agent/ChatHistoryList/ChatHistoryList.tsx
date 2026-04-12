import type { ChatHistoryEntry } from "../../../lib/chatHistory";
import { useCallback, useEffect, useState } from "react";
import { deleteChatHistory, listChatHistory } from "../../../lib/ipc";
import { CloseIcon } from "../../shared/Icons";
import styles from "./ChatHistoryList.module.css";

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

interface ChatHistoryListProps {
  onResume: (sessionId: string) => void;
  onView: (historyId: string) => void;
  repoRoot: string;
}

export function ChatHistoryList({
  repoRoot,
  onView,
  onResume,
}: ChatHistoryListProps) {
  const [entries, setEntries] = useState<ChatHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    listChatHistory(repoRoot)
      .then((result) => {
        setEntries(result);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [repoRoot]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, entry: ChatHistoryEntry) => {
      e.stopPropagation();
      deleteChatHistory(repoRoot, entry.id)
        .then(refresh)
        .catch(() => {});
    },
    [repoRoot, refresh],
  );

  if (!loaded) {
    return null;
  }

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Recent Sessions</span>
      </div>
      {entries.map((entry) => {
        const cost = formatCost(entry.totalCost);

        return (
          <div
            key={entry.id}
            className={styles.entry}
            onClick={() => onView(entry.id)}
          >
            <span className={styles.entryTitle}>{entry.title}</span>
            <div className={styles.entryMeta}>
              <span>{formatRelativeDate(entry.endedAt)}</span>
              <span className={styles.dot} />
              <span>{entry.workspaceBranch}</span>
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
            <div className={styles.actions}>
              <button
                className={styles.resumeBtn}
                title="Resume this session"
                onClick={(e) => {
                  e.stopPropagation();
                  onResume(entry.sessionId);
                }}
              >
                Resume
              </button>
              <button
                className={styles.deleteBtn}
                title="Delete"
                onClick={(e) => handleDelete(e, entry)}
              >
                <CloseIcon />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
