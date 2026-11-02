/**
 * A project's saved chats: listed, searched, deleted, pinned, read back and
 * resumed. Mirrors `HostStore+ChatHistory` / `+Pins`. Live agents are never
 * here; the host leaves those to `agents.list`.
 */

import { create } from "zustand";
import {
  describeError,
  type HistorySearchResult,
  spawnableMode,
} from "@argus/client-core";
import type {
  RemoteAgentStatus,
  RemoteMessage,
  RemoteStoppedAgent,
} from "../lib/protocol";
import { request } from "../lib/request";
import { useAgentsStore } from "./agents";
import { currentTransport } from "./connection";

interface StoppedTranscript {
  messages: RemoteMessage[];
  error: string | null;
}

interface ChatsState {
  /** Saved chats per repo root, as the host listed them. */
  stoppedByRepo: Record<string, RemoteStoppedAgent[]>;
  stoppedErrorByRepo: Record<string, string | null>;
  /** A saved chat's messages, keyed by `${repoRoot}:${historyId}`. */
  transcripts: Record<string, StoppedTranscript>;
  /** A saved chat's images, keyed like `transcripts` plus `:${imageId}`, as data URLs. */
  images: Record<string, string>;

  loadStopped: (repoRoot: string) => Promise<void>;
  search: (repoRoot: string, query: string) => Promise<HistorySearchResult[]>;
  remove: (repoRoot: string, historyIds: string[]) => Promise<void>;
  setPinned: (
    repoRoot: string,
    historyId: string,
    pinned: boolean,
  ) => Promise<void>;
  /** A new agent on the chat's conversation, runner, model, mode and effort. */
  resume: (
    chat: RemoteStoppedAgent,
    sessionId: string,
  ) => Promise<RemoteAgentStatus>;
  loadTranscript: (repoRoot: string, historyId: string) => Promise<void>;
  loadImage: (
    repoRoot: string,
    historyId: string,
    imageId: string,
  ) => Promise<void>;
}

const EMPTY = {
  stoppedByRepo: {},
  stoppedErrorByRepo: {},
  transcripts: {},
  images: {},
} satisfies Partial<ChatsState>;

export function chatKey(repoRoot: string, historyId: string): string {
  return `${repoRoot}:${historyId}`;
}

function connected() {
  const t = currentTransport();
  if (!t) {
    throw new Error("not connected");
  }

  return t;
}

export const useChatsStore = create<ChatsState>()((set, get) => ({
  ...EMPTY,

  loadStopped: async (repoRoot) => {
    try {
      const { agents } = await request(connected(), "agents.stopped", {
        repo_root: repoRoot,
        limit: 100,
      });
      set((s) => ({
        stoppedByRepo: { ...s.stoppedByRepo, [repoRoot]: agents },
        stoppedErrorByRepo: { ...s.stoppedErrorByRepo, [repoRoot]: null },
      }));
    } catch (err) {
      set((s) => ({
        stoppedErrorByRepo: {
          ...s.stoppedErrorByRepo,
          [repoRoot]: describeError(err),
        },
      }));
    }
  },

  search: async (repoRoot, query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const { results } = await request(connected(), "agents.history_search", {
      repo_root: repoRoot,
      query: trimmed.slice(0, 500),
    });

    return results;
  },

  remove: async (repoRoot, historyIds) => {
    const t = connected();
    for (const id of historyIds) {
      await request(t, "agents.history_delete", {
        repo_root: repoRoot,
        history_id: id,
      });
    }
    await get().loadStopped(repoRoot);
  },

  setPinned: async (repoRoot, historyId, pinned) => {
    const result = await request(connected(), "agents.set_pinned", {
      repo_root: repoRoot,
      history_id: historyId,
      pinned,
    });
    set((s) => ({
      stoppedByRepo: {
        ...s.stoppedByRepo,
        [repoRoot]: (s.stoppedByRepo[repoRoot] ?? []).map((c) =>
          c.history_id === historyId ? { ...c, pinned: result.pinned } : c,
        ),
      },
    }));
  },

  resume: async (chat, sessionId) => {
    const agents = useAgentsStore.getState();
    const mode = spawnableMode(chat.permission_mode);
    const agent = await agents.spawnAgent(sessionId, {
      resumeSessionId: chat.runner_session_id,
      ...(chat.model ? { model: chat.model } : {}),
      ...(mode ? { permissionMode: mode } : {}),
      ...(chat.runner_id ? { runnerId: chat.runner_id } : {}),
    });
    if (chat.effort) {
      await agents.setEffort(agent.agent_id, chat.effort).catch(() => {});
    }

    return agent;
  },

  loadTranscript: async (repoRoot, historyId) => {
    const key = chatKey(repoRoot, historyId);
    try {
      const { messages } = await request(
        connected(),
        "agents.stopped_transcript",
        { repo_root: repoRoot, history_id: historyId, limit: 500 },
      );
      set((s) => ({
        transcripts: { ...s.transcripts, [key]: { messages, error: null } },
      }));
    } catch (err) {
      set((s) => ({
        transcripts: {
          ...s.transcripts,
          [key]: {
            messages: s.transcripts[key]?.messages ?? [],
            error: describeError(err),
          },
        },
      }));
    }
  },

  loadImage: async (repoRoot, historyId, imageId) => {
    const key = `${chatKey(repoRoot, historyId)}:${imageId}`;
    if (get().images[key]) {
      return;
    }
    try {
      const { data, media_type } = await request(
        connected(),
        "agents.stopped_image",
        { repo_root: repoRoot, history_id: historyId, image_id: imageId },
      );
      set((s) => ({
        images: { ...s.images, [key]: `data:${media_type};base64,${data}` },
      }));
    } catch {
      // Left blank; reopening the chat retries.
    }
  },
}));

/** `sessions.changed` and friends: the lists already held, refetched. */
export function resyncStoppedChats(): void {
  const { stoppedByRepo, loadStopped } = useChatsStore.getState();
  for (const repoRoot of Object.keys(stoppedByRepo)) {
    void loadStopped(repoRoot);
  }
}

export function resetChats(): void {
  useChatsStore.setState(EMPTY);
}
