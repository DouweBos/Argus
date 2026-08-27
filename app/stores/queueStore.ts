/**
 * Mirror of the backend's per-agent message queue.
 *
 * The backend owns the queue (`electron/services/agent/messageQueue.ts`) and
 * persists it, so it survives an app restart and is shared with the web and
 * phone clients. This store is a read cache: mutations go out over IPC and
 * come back as an `agent:queue:<id>` broadcast, which is what updates state.
 */

import type { QueuedImage, QueuedMessage } from "../lib/types";
import { create } from "zustand";
import { listen, type UnlistenFn } from "../lib/events";
import {
  clearQueuedMessages as apiClear,
  dequeueMessage as apiDequeue,
  listQueuedMessages as apiList,
  queueMessage as apiQueue,
  removeQueuedMessage as apiRemove,
  updateQueuedMessage as apiUpdate,
} from "../lib/ipc";

interface QueueStoreData {
  /** agent_id → messages waiting on that agent, oldest first. */
  queues: Record<string, QueuedMessage[]>;
}

const queueStore = create<QueueStoreData>(() => ({ queues: {} }));

export const useQueueStore = queueStore;

const EMPTY: QueuedMessage[] = [];

export const useQueuedMessages = (agentId: string | null): QueuedMessage[] =>
  queueStore((s) => (agentId ? (s.queues[agentId] ?? EMPTY) : EMPTY));

export const getQueuedMessages = (agentId: string): QueuedMessage[] =>
  queueStore.getState().queues[agentId] ?? EMPTY;

function setQueue(agentId: string, messages: QueuedMessage[]): void {
  queueStore.setState((state) => ({
    queues: { ...state.queues, [agentId]: messages },
  }));
}

const subscriptions = new Map<string, Promise<UnlistenFn>>();

/**
 * Track an agent's queue: fetch the current contents and follow the backend's
 * broadcasts. Safe to call repeatedly — only the first call per agent
 * subscribes.
 */
export function watchQueue(agentId: string): void {
  if (subscriptions.has(agentId)) {
    return;
  }
  subscriptions.set(
    agentId,
    listen<QueuedMessage[]>(`agent:queue:${agentId}`, ({ payload }) =>
      setQueue(agentId, payload),
    ),
  );
  apiList(agentId)
    .then((messages) => setQueue(agentId, messages))
    .catch(() => {});
}

export function unwatchQueue(agentId: string): void {
  const sub = subscriptions.get(agentId);
  if (!sub) {
    return;
  }
  subscriptions.delete(agentId);
  sub.then((un) => un()).catch(() => {});
}

export function queueMessage(
  agentId: string,
  text: string,
  images?: QueuedImage[],
  displayText?: string,
): void {
  watchQueue(agentId);
  apiQueue(agentId, text, images, displayText).catch(() => {});
}

export function removeQueuedMessage(agentId: string, id: string): void {
  apiRemove(agentId, id).catch(() => {});
}

export function updateQueuedMessage(
  agentId: string,
  id: string,
  text: string,
): void {
  apiUpdate(agentId, id, text).catch(() => {});
}

/** Drop everything queued — the turns they were written against are gone. */
export function clearQueue(agentId: string): void {
  apiClear(agentId).catch(() => {});
}

/** Pop the next queued message. Resolves to null when nothing is waiting. */
export function dequeueMessage(agentId: string): Promise<QueuedMessage | null> {
  return apiDequeue(agentId).catch(() => null);
}
