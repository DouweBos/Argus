/**
 * Agent transcripts: structured messages, optimistic sends, tasks, todos,
 * follow-ups and resolved images. Mirrors `HostStore+TranscriptSync`. Pages
 * come from `agents.transcript`; after that the host's `agent.transcript`
 * deltas keep them current, with a refetch whenever a delta doesn't follow.
 */

import { create } from "zustand";
import {
  applyDeltaMessages,
  deltaAction,
  type TranscriptCursor,
} from "@argus/client-core";
import { jsonEq } from "../lib/equality";
import type {
  RemoteImageAttachment,
  RemoteMessage,
  RemoteTask,
  RemoteTodo,
  RemoteTranscript,
  RemoteTranscriptDelta,
} from "../lib/protocol";
import { request } from "../lib/request";
import {
  mergeTail,
  pendingOptimistic,
  prependOlder,
  withValue,
} from "../lib/transcriptMerge";
import { currentTransport } from "./connection";
import { useAgentsStore } from "./agents";

/** Messages fetched per transcript page (tail on open, older on scroll-up). */
const TRANSCRIPT_PAGE = 80;

export function imageKey(agentId: string, imageId: string): string {
  return `${agentId}:${imageId}`;
}

/** The map with this agent's follow-ups replaced, or itself when unchanged. */
function withFollowUps(
  byAgent: Record<string, string[]>,
  agentId: string,
  followUps: string[] | undefined,
): Record<string, string[]> {
  const next = followUps ?? [];

  return jsonEq(byAgent[agentId] ?? [], next)
    ? byAgent
    : { ...byAgent, [agentId]: next };
}

interface TranscriptsState {
  messagesByAgent: Record<string, RemoteMessage[]>;
  /** Locally-appended user messages awaiting confirmation in the next page. */
  optimisticByAgent: Record<string, RemoteMessage[]>;
  tasksByAgent: Record<string, RemoteTask[] | null>;
  todosByAgent: Record<string, RemoteTodo[] | null>;
  /** Replies suggested once each agent's last turn ended. */
  followUpsByAgent: Record<string, string[]>;
  /** Name of the tool currently executing per agent (drives the activity row). */
  pendingToolByAgent: Record<string, string | null>;
  /** Cursor to fetch the next older page per agent (null = start reached). */
  prevBeforeByAgent: Record<string, number | null>;
  /** Resolved image bytes keyed by `${agentId}:${imageId}` → data URL. */
  imageCache: Record<string, string>;

  loadTranscript: (agentId: string) => Promise<void>;
  /** Fetch and prepend the next page of older messages (lazy scroll-up). */
  loadOlderMessages: (agentId: string) => Promise<void>;
  loadImage: (agentId: string, imageId: string) => Promise<void>;
  sendMessage: (
    agentId: string,
    message: string,
    images?: RemoteImageAttachment[],
    /** Text to show in the optimistic bubble (message minus any preamble). */
    displayText?: string,
  ) => Promise<void>;
}

const EMPTY = {
  messagesByAgent: {},
  optimisticByAgent: {},
  tasksByAgent: {},
  todosByAgent: {},
  followUpsByAgent: {},
  pendingToolByAgent: {},
  prevBeforeByAgent: {},
  imageCache: {},
} satisfies Partial<TranscriptsState>;

// Where each transcript's newest page sits in the host's deltas. An agent
// whose host has sent one stops refetching on every event.
const cursors = new Map<string, TranscriptCursor>();
const followsDeltas = new Set<string>();
/** Deltas that arrived while a page was in flight, keyed by agent. */
const buffered = new Map<string, RemoteTranscriptDelta[]>();
/** Debounce live refreshes so a burst of events is one refetch. */
const refetchTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useTranscriptsStore = create<TranscriptsState>()((set, get) => ({
  ...EMPTY,

  loadTranscript: async (agentId) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    const firstLoad = get().messagesByAgent[agentId] === undefined;
    // No snapshot yet (the agent hasn't produced output) surfaces as an
    // error: treat it as empty so the UI shows an empty state rather than
    // spinning forever. Omitting the cursor fetches the tail; older history
    // lazy-loads on scroll-up.
    let res: RemoteTranscript = { messages: [], next_after: null };
    const waiting: RemoteTranscriptDelta[] = buffered.get(agentId) ?? [];
    buffered.set(agentId, waiting);
    try {
      res = await request(t, "agents.transcript", {
        agent_id: agentId,
        limit: TRANSCRIPT_PAGE,
      });
    } catch {
      res = { messages: [], next_after: null };
    } finally {
      buffered.delete(agentId);
    }
    if (res.epoch !== undefined && res.revision !== undefined) {
      cursors.set(agentId, { epoch: res.epoch, revision: res.revision });
    }
    set((s) => {
      const existing = s.messagesByAgent[agentId];
      const merged = mergeTail(existing, res.messages);
      const prevOptimistic = s.optimisticByAgent[agentId] ?? [];
      const stillPending = pendingOptimistic(prevOptimistic, res.messages);

      return {
        messagesByAgent:
          merged === existing
            ? s.messagesByAgent
            : { ...s.messagesByAgent, [agentId]: merged },
        optimisticByAgent:
          stillPending === prevOptimistic
            ? s.optimisticByAgent
            : { ...s.optimisticByAgent, [agentId]: stillPending },
        // Set the older-cursor on first load only; scroll-up moves it back.
        prevBeforeByAgent: firstLoad
          ? { ...s.prevBeforeByAgent, [agentId]: res.prev_before ?? null }
          : s.prevBeforeByAgent,
        tasksByAgent: withValue(s.tasksByAgent, agentId, res.tasks ?? null),
        todosByAgent: withValue(s.todosByAgent, agentId, res.todos ?? null),
        followUpsByAgent: withFollowUps(
          s.followUpsByAgent,
          agentId,
          res.follow_ups,
        ),
        pendingToolByAgent: {
          ...s.pendingToolByAgent,
          [agentId]: res.pending_tool_name ?? null,
        },
      };
    });
    // Deltas that raced the page: anything it already had is dropped.
    for (const delta of waiting) {
      applyDelta(delta);
    }
  },

  loadOlderMessages: async (agentId) => {
    const t = currentTransport();
    const cursor = get().prevBeforeByAgent[agentId];
    if (!t || cursor == null) {
      return;
    }
    const res = await request(t, "agents.transcript", {
      agent_id: agentId,
      before: cursor,
      limit: TRANSCRIPT_PAGE,
    });
    set((s) => ({
      messagesByAgent: {
        ...s.messagesByAgent,
        [agentId]: prependOlder(s.messagesByAgent[agentId] ?? [], res.messages),
      },
      prevBeforeByAgent: {
        ...s.prevBeforeByAgent,
        [agentId]: res.prev_before ?? null,
      },
    }));
  },

  loadImage: async (agentId, imageId) => {
    const key = imageKey(agentId, imageId);
    if (get().imageCache[key]) {
      return;
    }
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { data, media_type } = await request(t, "agents.image", {
        agent_id: agentId,
        image_id: imageId,
      });
      const url = `data:${media_type};base64,${data}`;
      set((s) => ({ imageCache: { ...s.imageCache, [key]: url } }));
    } catch {
      // Leave uncached; the next event's refetch retries.
    }
  },

  sendMessage: async (agentId, message, images, displayText) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    // Show the message right away; the next page reconciles or removes it.
    const id = `optimistic-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const imageRefs = (images ?? []).map((img, i) => ({
      image_id: `${id}:img:${i}`,
      media_type: img.media_type,
    }));
    const optimistic: RemoteMessage = {
      id,
      role: "user",
      text_blocks: [displayText ?? message],
      tool_calls: [],
      ...(imageRefs.length > 0 ? { images: imageRefs } : {}),
      timestamp: Date.now(),
    };
    set((s) => ({
      optimisticByAgent: {
        ...s.optimisticByAgent,
        [agentId]: [...(s.optimisticByAgent[agentId] ?? []), optimistic],
      },
      imageCache: {
        ...s.imageCache,
        ...Object.fromEntries(
          (images ?? []).map((img, i) => [
            imageKey(agentId, `${id}:img:${i}`),
            `data:${img.media_type};base64,${img.data}`,
          ]),
        ),
      },
    }));

    const { queued } = await request(t, "agents.send", {
      agent_id: agentId,
      message,
      ...(displayText && displayText !== message
        ? { display_text: displayText }
        : {}),
      ...(images && images.length > 0 ? { images } : {}),
    });
    // The computer found the agent mid-turn and parked this on its queue. It
    // belongs in the queue strip, so retire the optimistic bubble now.
    if (queued) {
      set((s) => ({
        optimisticByAgent: {
          ...s.optimisticByAgent,
          [agentId]: (s.optimisticByAgent[agentId] ?? []).filter(
            (m) => m.id !== id,
          ),
        },
      }));
      const agents = useAgentsStore.getState();
      agents.loadQueue(agentId).catch(() => {});
      agents.loadAgentStatus(agentId).catch(() => {});

      return;
    }
    // Nudge a refresh so the real message reconciles promptly.
    get()
      .loadTranscript(agentId)
      .catch(() => {});
  },
}));

function applyDelta(delta: RemoteTranscriptDelta): void {
  const agentId = delta.agent_id;
  const action = deltaAction(cursors.get(agentId), delta);
  if (action === "drop") {
    return;
  }
  if (action === "refetch") {
    scheduleTranscript(agentId);

    return;
  }
  cursors.set(agentId, { epoch: delta.epoch, revision: delta.revision });
  useTranscriptsStore.setState((s) => {
    const existing = s.messagesByAgent[agentId] ?? [];
    const messages = applyDeltaMessages(existing, delta);

    return {
      messagesByAgent:
        messages === existing
          ? s.messagesByAgent
          : { ...s.messagesByAgent, [agentId]: messages },
      tasksByAgent: jsonEq(s.tasksByAgent[agentId], delta.tasks)
        ? s.tasksByAgent
        : { ...s.tasksByAgent, [agentId]: delta.tasks },
      todosByAgent: jsonEq(s.todosByAgent[agentId], delta.todos)
        ? s.todosByAgent
        : { ...s.todosByAgent, [agentId]: delta.todos },
      followUpsByAgent: withFollowUps(
        s.followUpsByAgent,
        agentId,
        delta.follow_ups,
      ),
      pendingToolByAgent: {
        ...s.pendingToolByAgent,
        [agentId]: delta.pending_tool_name,
      },
    };
  });
}

/** Refetch an agent's newest page soon, coalescing a burst into one. */
export function scheduleTranscript(agentId: string): void {
  clearTimeout(refetchTimers.get(agentId));
  refetchTimers.set(
    agentId,
    setTimeout(() => {
      useTranscriptsStore
        .getState()
        .loadTranscript(agentId)
        .catch(() => {});
    }, 300),
  );
}

/** Refetch unless the host already streams this agent's deltas. */
export function refreshUnlessFollowing(agentId: string): void {
  if (!followsDeltas.has(agentId)) {
    scheduleTranscript(agentId);
  }
}

/** `agent.transcript`: apply in order, or hold it while a page is in flight. */
export function receiveDelta(delta: RemoteTranscriptDelta): void {
  followsDeltas.add(delta.agent_id);
  const waiting = buffered.get(delta.agent_id);
  if (waiting) {
    waiting.push(delta);
  } else {
    applyDelta(delta);
  }
}

/**
 * Transcripts on screen, refetched after a reconnect: the host forgets a
 * dropped connection's subscriptions, so deltas sent meanwhile never arrived.
 */
export function resyncTranscripts(): void {
  for (const agentId of Object.keys(
    useTranscriptsStore.getState().messagesByAgent,
  )) {
    scheduleTranscript(agentId);
  }
}

export function resetTranscripts(): void {
  for (const timer of refetchTimers.values()) {
    clearTimeout(timer);
  }
  refetchTimers.clear();
  cursors.clear();
  followsDeltas.clear();
  buffered.clear();
  useTranscriptsStore.setState(EMPTY);
}
