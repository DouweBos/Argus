import { updateAgent } from "../stores/agentStore";
import { rewindAgent } from "./ipc";

/**
 * Restore both the worktree and the conversation to the point just before
 * `messageId` was sent. Files are reverted to the snapshot captured when the
 * message was originally dispatched; the conversation is rewound to the same
 * point and the original prompt is returned so the caller can put it back in
 * the input field.
 *
 * The agent is respawned in place under the same agentId — same flow used by
 * {@link editAndRestoreFromMessage}, just without sending a new prompt.
 */
export async function restoreFromMessage(
  _sessionId: string,
  agentId: string,
  messageId: string,
): Promise<{ restoredPrompt: string }> {
  updateAgent(agentId, { status: "running" });
  try {
    const { restoredPrompt } = await rewindAgent(agentId, messageId, {
      restoreFiles: true,
    });

    return { restoredPrompt };
  } finally {
    updateAgent(agentId, { status: "idle" });
  }
}
