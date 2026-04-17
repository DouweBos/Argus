import type { ChatHistoryEntry } from "../lib/chatHistory";
import { useCallback, useEffect, useState } from "react";
import { deleteChatHistory, listChatHistory } from "../lib/ipc";

export interface UseChatHistoryResult {
  entries: ChatHistoryEntry[];
  loaded: boolean;
  refresh: () => void;
  remove: (historyId: string) => void;
}

export function useChatHistory(repoRoot: string | null): UseChatHistoryResult {
  const [entries, setEntries] = useState<ChatHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!repoRoot) {
      return;
    }
    let cancelled = false;
    listChatHistory(repoRoot)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setEntries(result);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot, refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const remove = useCallback(
    (historyId: string) => {
      if (!repoRoot) {
        return;
      }
      deleteChatHistory(repoRoot, historyId)
        .then(refresh)
        .catch(() => {});
    },
    [repoRoot, refresh],
  );

  return { entries, loaded, refresh, remove };
}
