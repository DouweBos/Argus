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
 * Clients read and mutate through the queue commands (`commands/agents.ts`) or the remote
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
  /** Who queued it, when a huddle guest rather than the engineer did. */
  author?: string;
  images?: QueuedImage[];
  queued_at: number;
}

/** Queues that wait for the user instead of draining on their own. */
const parked = new Set<string>();
/** Queued again after a send that failed; their bubble is already in the chat. */
const undelivered = new WeakSet<QueuedMessage>();

function emit(agentId: string): void {
  if (listQueue(agentId).length === 0) {
    parked.delete(agentId);
  }
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
    author?: string;
    images?: QueuedImage[];
  },
): QueuedMessage {
  const queued = toQueued(message);

  const existing = appState.agentQueues.get(agentId) ?? [];
  if (existing.length >= MAX_PER_AGENT) {
    throw `Message queue for ${agentId} is full`;
  }
  appState.agentQueues.set(agentId, [...existing, queued]);
  emit(agentId);

  return queued;
}

function toQueued(message: {
  text: string;
  displayText?: string;
  author?: string;
  images?: QueuedImage[];
}): QueuedMessage {
  return {
    id: crypto.randomUUID(),
    text: message.text,
    ...(message.displayText && message.displayText !== message.text
      ? { display_text: message.displayText }
      : {}),
    ...(message.author ? { author: message.author } : {}),
    ...(message.images?.length ? { images: message.images } : {}),
    queued_at: Date.now(),
  };
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

/** Move a message to the head of the queue, so it is the next one sent. */
export function promoteQueuedMessage(agentId: string, id: string): boolean {
  const existing = appState.agentQueues.get(agentId);
  const message = existing?.find((m) => m.id === id);
  if (!existing || !message) {
    return false;
  }
  if (existing[0] !== message) {
    appState.agentQueues.set(agentId, [
      message,
      ...existing.filter((m) => m.id !== id),
    ]);
    emit(agentId);
  }

  return true;
}

/** Back at the head, in order, and waiting for the user to try again. */
export function requeueUndelivered(
  agentId: string,
  messages: {
    text: string;
    displayText?: string;
    author?: string;
    images?: QueuedImage[];
  }[],
): void {
  const returned = messages.map((message) => {
    const queued = toQueued(message);
    undelivered.add(queued);

    return queued;
  });
  appState.agentQueues.set(agentId, [...returned, ...listQueue(agentId)]);
  parked.add(agentId);
  emit(agentId);
}

export function isQueueParked(agentId: string): boolean {
  return parked.has(agentId);
}

export function wasShown(message: QueuedMessage): boolean {
  return undelivered.has(message);
}

/** Let the queue drain again. Announced, since its event is what drains it. */
export function unparkQueue(agentId: string): void {
  if (parked.delete(agentId)) {
    emit(agentId);
  }
}

/** Take out what couldn't be delivered, to go ahead of a send. */
export function takeUndelivered(agentId: string): {
  text: string;
  displayText?: string;
  author?: string;
  images?: QueuedImage[];
}[] {
  const queue = listQueue(agentId);
  const taken = queue.filter(wasShown);
  if (taken.length === 0) {
    return [];
  }
  appState.agentQueues.set(
    agentId,
    queue.filter((m) => !wasShown(m)),
  );
  emit(agentId);

  return taken.map((m) => ({
    text: m.text,
    displayText: m.display_text,
    author: m.author,
    images: m.images,
  }));
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
  parked.delete(agentId);
  if (!appState.agentQueues.has(agentId)) {
    return;
  }
  appState.agentQueues.delete(agentId);
  emit(agentId);
}
