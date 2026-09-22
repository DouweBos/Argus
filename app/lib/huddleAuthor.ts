/**
 * The name to stamp on the engineer's own messages.
 *
 * Only while the agent is shared: a solo transcript needs no attribution, and
 * labelling every message in one would be noise. Once guests are reading along,
 * an unattributed bubble is ambiguous — it could be any of them — so the host's
 * messages have to say whose they are, exactly like a guest's do.
 */

import { getHuddleRoomForAgent } from "../stores/huddleStore";

export function huddleAuthor(agentId: string | null): string | undefined {
  if (!agentId) {
    return undefined;
  }

  return getHuddleRoomForAgent(agentId)?.host_label || undefined;
}
