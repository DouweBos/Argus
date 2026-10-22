/**
 * Replies the user might send next, offered in every chat input once a turn
 * ends. A small model reads the agent's last message; what it suggests rides
 * the conversation's meta, so every viewer gets it with the transcript.
 */

import type { AgentConversation } from "./types";
import { loadAppSettings } from "../../appSettings/store";
import { generateFollowUps } from "../../llm/followUps";
import { capture as telemetryCapture } from "../../telemetry/telemetry";
import { conversationOf, type Tracked, trackedEntry, update } from "./folded";

/** The last message, when it is the agent's and says something. */
function finalAgentMessage(
  conversation: AgentConversation,
): { id: string; text: string } | null {
  const last = conversation.messages.at(-1);
  if (!last || last.role !== "assistant") {
    return null;
  }
  const text = last.textBlocks.join("\n\n").trim();

  return text ? { id: last.id, text } : null;
}

/** Ask for follow-ups to the turn that just ended. */
export function suggestFollowUps(agentId: string, entry: Tracked): void {
  // An agent another agent drives has nobody at its input.
  if (entry.parentAgentId) {
    return;
  }
  if (loadAppSettings().follow_up_suggestions === false) {
    return;
  }
  const final = finalAgentMessage(conversationOf(agentId));
  if (!final) {
    return;
  }
  generateFollowUps(final.text)
    .then((followUps) => {
      telemetryCapture("follow_ups_suggested", {
        count: followUps?.length ?? 0,
        success: followUps !== null,
      });
      if (!followUps?.length || trackedEntry(agentId) !== entry) {
        return;
      }
      // Too late once the conversation moved on: a new turn, or a rewind.
      if (
        entry.inflight ||
        finalAgentMessage(conversationOf(agentId))?.id !== final.id
      ) {
        return;
      }
      update(agentId, entry, (c) => ({ ...c, followUps }));
    })
    .catch(() => undefined);
}

/** Drop suggestions that no longer answer the last turn. */
export function clearFollowUps(agentId: string, entry: Tracked): void {
  update(agentId, entry, (c) => {
    if (!c.followUps) {
      return null;
    }
    const { followUps: _, ...rest } = c;

    return rest;
  });
}
