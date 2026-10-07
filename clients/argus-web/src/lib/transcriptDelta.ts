/**
 * Following a transcript with the host's `agent.transcript` deltas instead of
 * refetching its tail on every event. Pure; the store keeps the cursors.
 */

import type { RemoteMessage, RemoteTranscriptDelta } from "./protocol";

export interface TranscriptCursor {
  epoch: string;
  revision: number;
}

/**
 * What to do with a delta: apply it, drop it (the page already had it), or
 * refetch (it doesn't follow what is shown).
 */
export function deltaAction(
  cursor: TranscriptCursor | undefined,
  delta: RemoteTranscriptDelta,
): "apply" | "drop" | "refetch" {
  if (!cursor || cursor.epoch !== delta.epoch) {
    return "refetch";
  }
  if (delta.revision <= cursor.revision) {
    return "drop";
  }

  return delta.revision === cursor.revision + 1 ? "apply" : "refetch";
}

/** Upsert by id (unknown ids append, in order) and drop the removed ones. */
export function applyDeltaMessages(
  messages: RemoteMessage[],
  delta: RemoteTranscriptDelta,
): RemoteMessage[] {
  if (delta.messages.length === 0 && delta.removed_ids.length === 0) {
    return messages;
  }
  const removed = new Set(delta.removed_ids);
  const updates = new Map(delta.messages.map((m) => [m.id, m]));
  const next: RemoteMessage[] = [];
  for (const m of messages) {
    if (removed.has(m.id)) {
      continue;
    }
    const updated = updates.get(m.id);
    if (updated) {
      updates.delete(m.id);
      next.push(updated);
    } else {
      next.push(m);
    }
  }

  return [...next, ...updates.values()];
}
