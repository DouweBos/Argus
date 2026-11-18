/**
 * Stamps a session's last message for the clients' recency sort. A user
 * message or a turn's end goes out at once; a streaming agent at most once
 * per `THROTTLE_MS`, so output doesn't flood clients with session updates.
 */

import { publishLastMessage, setLastMessageAt } from "./triage";

export const THROTTLE_MS = 30_000;

const published = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function publish(sessionId: string): void {
  clearTimeout(timers.get(sessionId));
  timers.delete(sessionId);
  published.set(sessionId, Date.now());
  publishLastMessage(sessionId);
}

/** The user (or another agent) sent it a message. */
export function stampUserMessage(sessionId: string): void {
  setLastMessageAt(sessionId, Date.now());
  publish(sessionId);
}

/** An agent in it wrote something; held back while the last update is fresh. */
export function stampAgentMessage(sessionId: string): void {
  const now = Date.now();
  setLastMessageAt(sessionId, now);
  const since = now - (published.get(sessionId) ?? 0);
  if (since >= THROTTLE_MS) {
    publish(sessionId);
  } else if (!timers.has(sessionId)) {
    timers.set(
      sessionId,
      setTimeout(() => publish(sessionId), THROTTLE_MS - since),
    );
  }
}

/** A turn ended: send whatever the throttle is holding. */
export function flushLastMessage(sessionId: string): void {
  if (timers.has(sessionId)) {
    publish(sessionId);
  }
}

export function stopLastMessageStamps(): void {
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();
  published.clear();
}
