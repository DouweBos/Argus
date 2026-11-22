import type { AgentConversation } from "./types";
import { withSystemMessage } from "./reducer";

export interface WakeFailure {
  reason: string;
  /** The messages that were waking it went back to the queue. */
  queued: boolean;
}

/** A paused agent couldn't resume: say why, and what retries. */
export function withWakeFailure(
  conversation: AgentConversation,
  { reason, queued }: WakeFailure,
  stderrTail: string[] = [],
): AgentConversation {
  const lines = [`Couldn't resume this chat: ${reason}`];
  if (queued) {
    lines.push(
      "Your message is back in the queue. Send again or use Send now to retry.",
    );
  }
  if (stderrTail.length > 0) {
    lines.push(stderrTail.join("\n"));
  }

  return withSystemMessage(conversation, {
    id: crypto.randomUUID(),
    role: "system",
    tone: "error",
    textBlocks: lines,
    toolCalls: [],
    timestamp: Date.now(),
  });
}
