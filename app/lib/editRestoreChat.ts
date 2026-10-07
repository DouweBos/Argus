import { notifyMessageSent } from "./agentEventService";
import { rewindAgent } from "./ipc";

/**
 * Edit a user message and restore the conversation to that point.
 *
 * The host does the work: it cuts the transcript before the message, drops
 * the queue (written against turns that no longer exist), kills the CLI,
 * forks its JSONL to the target turn, respawns it under the **same** agent id
 * and sends the edited text. From here the agent never went away.
 *
 * When editing the very first user message the host starts fresh instead
 * (the CLI rejects a --resume on a JSONL with no user turns).
 */
export async function editAndRestoreFromMessage(
  _sessionId: string,
  agentId: string,
  messageId: string,
  newText: string,
): Promise<void> {
  // Busy for the whole dance; the host holds status emits until it sends.
  notifyMessageSent(agentId);
  await rewindAgent(agentId, messageId, { resend: { text: newText } });
}
