/**
 * Per-agent message queue, owned by the backend.
 *
 * Messages typed while an agent is busy wait here until its turn ends. The
 * queue lives in the main process rather than in a client, so it is shared by
 * all of them — a message queued from the phone drains on the desktop, and
 * reloading the web client or reinstalling the phone app doesn't lose it.
 *
 * Deliberately not persisted to disk: a queue is only reachable through its
 * agent id, and agents don't outlive the app, so a queue written to disk could
 * only ever be reloaded as an orphan.
 *
 * Clients read and mutate through IPC (`electron/ipc.ts`) or the remote
 * gateway; both funnel here, and every change broadcasts `agent:queue:<id>`.
 */

import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";

/** Cap per agent so a runaway client can't grow a queue without bound. */
const MAX_PER_AGENT = 100;

export interface QueuedImage {
  data: string;
  media_type: string;
}

export interface QueuedMessage {
  id: string;
  /** What gets sent to the agent — may carry a preamble the user never typed. */
  text: string;
  /** What the clients show, when it differs from `text`. */
  display_text?: string;
  images?: QueuedImage[];
  queued_at: number;
}

function emit(agentId: string): void {
  emitHostEvent(`agent:queue:${agentId}`, listQueue(agentId));
}

/** Everything waiting for this agent, oldest first. */
export function listQueue(agentId: string): QueuedMessage[] {
  return appState.agentQueues.get(agentId) ?? [];
}

export function enqueueMessage(
  agentId: string,
  message: {
    text: string;
    displayText?: string;
    images?: QueuedImage[];
  },
): QueuedMessage {
  const queued: QueuedMessage = {
    id: crypto.randomUUID(),
    text: message.text,
    ...(message.displayText && message.displayText !== message.text
      ? { display_text: message.displayText }
      : {}),
    ...(message.images?.length ? { images: message.images } : {}),
    queued_at: Date.now(),
  };

  const existing = appState.agentQueues.get(agentId) ?? [];
  if (existing.length >= MAX_PER_AGENT) {
    throw `Message queue for ${agentId} is full`;
  }
  appState.agentQueues.set(agentId, [...existing, queued]);
  emit(agentId);

  return queued;
}

export function removeQueuedMessage(agentId: string, id: string): void {
  const existing = appState.agentQueues.get(agentId);
  if (!existing) {
    return;
  }
  const next = existing.filter((m) => m.id !== id);
  if (next.length === existing.length) {
    return;
  }
  appState.agentQueues.set(agentId, next);
  emit(agentId);
}

export function updateQueuedMessage(
  agentId: string,
  id: string,
  text: string,
): void {
  const existing = appState.agentQueues.get(agentId);
  if (!existing) {
    return;
  }
  let changed = false;
  const next = existing.map((m) => {
    if (m.id !== id) {
      return m;
    }
    changed = true;

    // An edited message is what the user meant; the old preamble no longer
    // describes it, so the display text collapses back to the text itself.
    return { ...m, text, display_text: undefined };
  });
  if (!changed) {
    return;
  }
  appState.agentQueues.set(agentId, next);
  emit(agentId);
}

/** Pop the oldest queued message, or undefined when the queue is empty. */
export function dequeueMessage(agentId: string): QueuedMessage | undefined {
  const existing = appState.agentQueues.get(agentId);
  if (!existing || existing.length === 0) {
    return undefined;
  }
  const [first, ...rest] = existing;
  appState.agentQueues.set(agentId, rest);
  emit(agentId);

  return first;
}

/** Drop an agent's queue entirely — it stopped, or its session went away. */
export function clearQueue(agentId: string): void {
  if (!appState.agentQueues.has(agentId)) {
    return;
  }
  appState.agentQueues.delete(agentId);
  emit(agentId);
}
