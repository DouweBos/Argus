/**
 * Which live sessions are teammate conversations. A leaf: the agent service,
 * the idle sweep and the shell guard ask it without importing the teammate
 * service.
 */

const bySession = new Map<string, { teammateId: string; threadId: string }>();

export function threadSessionId(threadId: string): string {
  return `teammate-thread-${threadId}`;
}

export function registerThreadSession(
  sessionId: string,
  teammateId: string,
  threadId: string,
): void {
  bySession.set(sessionId, { teammateId, threadId });
}

export function forgetThreadSession(sessionId: string): void {
  bySession.delete(sessionId);
}

export function teammateThreadForSession(
  sessionId: string | null | undefined,
): { teammateId: string; threadId: string } | null {
  return (sessionId && bySession.get(sessionId)) || null;
}

let messageListener: ((threadId: string, text: string) => void) | null = null;

export function onThreadMessage(
  listener: (threadId: string, text: string) => void,
): void {
  messageListener = listener;
}

/** The agent service tells the thread what the user said, for its title. */
export function noteThreadMessage(sessionId: string, text: string): void {
  const thread = teammateThreadForSession(sessionId);
  if (thread && messageListener) {
    messageListener(thread.threadId, text);
  }
  noteThreadTurn(sessionId, { kind: "started" });
}

/** How a thread's turn ended, as the agent service saw it. */
export type ThreadTurnEvent =
  | { kind: "exit"; code: number; intentional: boolean }
  | { kind: "result"; failed: boolean; text: string; resetsAt: number | null }
  | { kind: "started" };

let turnListener: ((threadId: string, event: ThreadTurnEvent) => void) | null =
  null;

export function onThreadTurn(
  listener: (threadId: string, event: ThreadTurnEvent) => void,
): void {
  turnListener = listener;
}

/** The agent service reports turn starts and ends so a failure can be kept. */
export function noteThreadTurn(
  sessionId: string,
  event: ThreadTurnEvent,
): void {
  const thread = teammateThreadForSession(sessionId);
  if (thread && turnListener) {
    turnListener(thread.threadId, event);
  }
}
