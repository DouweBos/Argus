/**
 * Folding a freshly fetched transcript page into what is already on screen.
 * Pure; the transcripts store owns the state. References are reused wherever
 * nothing changed, so a refresh that returns the same data re-renders nothing
 * (and leaves the scroll position alone).
 */

import { jsonEq, sameRefs } from "./equality";
import type { RemoteMessage } from "./protocol";

/**
 * Merge the newest page into older pages already loaded. Messages not in the
 * tail are older, so they stay ahead of it; unchanged messages keep their
 * previous object. Returns `existing` itself when nothing moved.
 */
export function mergeTail(
  existing: RemoteMessage[] | undefined,
  tail: RemoteMessage[],
): RemoteMessage[] {
  const current = existing ?? [];
  const tailIds = new Set(tail.map((m) => m.id));
  const prevById = new Map(current.map((m) => [m.id, m]));
  const keep = (m: RemoteMessage): RemoteMessage => {
    const prev = prevById.get(m.id);

    return prev && jsonEq(prev, m) ? prev : m;
  };
  const next = [...current.filter((m) => !tailIds.has(m.id)), ...tail.map(keep)];

  return existing !== undefined && sameRefs(next, existing) ? existing : next;
}

/**
 * Drop optimistic bubbles the page now includes: a server user message whose
 * text contains the optimistic text (tolerating the linked-projects preamble
 * the real message may carry). Returns `optimistic` itself when none went.
 */
export function pendingOptimistic(
  optimistic: RemoteMessage[],
  tail: RemoteMessage[],
): RemoteMessage[] {
  const serverUserText = tail
    .filter((m) => m.role === "user")
    .map((m) => m.text_blocks.join("\n"));
  const next = optimistic.filter((o) => {
    const text = o.text_blocks.join("\n").trim();

    return text.length > 0 && !serverUserText.some((st) => st.includes(text));
  });

  return sameRefs(next, optimistic) ? optimistic : next;
}

/** Older messages prepended to a transcript, skipping any already there. */
export function prependOlder(
  existing: RemoteMessage[],
  older: RemoteMessage[],
): RemoteMessage[] {
  const ids = new Set(existing.map((m) => m.id));

  return [...older.filter((m) => !ids.has(m.id)), ...existing];
}

/** The map with `key` set to `value`, or itself when the value is unchanged. */
export function withValue<T>(
  map: Record<string, T>,
  key: string,
  value: T,
): Record<string, T> {
  return key in map && jsonEq(map[key], value) ? map : { ...map, [key]: value };
}
