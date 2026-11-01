import type { ChatHistoryEntry } from "../lib/chatHistory";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteChatHistory,
  listChatHistory,
  setChatHistoryPinned,
} from "../lib/ipc";
import { useAgentsRecord } from "../stores/agentStore";
import { useConversations } from "../stores/conversationStore";

export interface UseChatHistoryResult {
  clearAll: () => void;
  entries: ChatHistoryEntry[];
  loaded: boolean;
  refresh: () => void;
  remove: (historyId: string) => void;
  setPinned: (historyId: string, pinned: boolean) => void;
}

export function useChatHistory(repoRoot: string | null): UseChatHistoryResult {
  const [allEntries, setAllEntries] = useState<ChatHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const agents = useAgentsRecord();
  const conversations = useConversations();

  // Session IDs of agents currently open in the tab bar — these chats are
  // "live" and should not show up as resumable recent sessions.
  const openSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const agentId of Object.keys(agents)) {
      const sessionId = conversations[agentId]?.sessionId;
      if (sessionId) {
        ids.add(sessionId);
      }
    }

    return ids;
  }, [agents, conversations]);

  const entries = useMemo(
    () => allEntries.filter((entry) => !openSessionIds.has(entry.sessionId)),
    [allEntries, openSessionIds],
  );

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
        setAllEntries(result);
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

  const clearAll = useCallback(() => {
    if (!repoRoot || entries.length === 0) {
      return;
    }
    Promise.all(
      entries.map((entry) =>
        deleteChatHistory(repoRoot, entry.id).catch(() => {}),
      ),
    ).then(refresh);
  }, [repoRoot, entries, refresh]);

  const setPinned = useCallback(
    (historyId: string, pinned: boolean) => {
      if (!repoRoot) {
        return;
      }
      setChatHistoryPinned(repoRoot, historyId, pinned)
        .then(refresh)
        .catch(() => {});
    },
    [repoRoot, refresh],
  );

  return { clearAll, entries, loaded, refresh, remove, setPinned };
}
