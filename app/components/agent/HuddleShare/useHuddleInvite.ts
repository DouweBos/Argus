import { huddleInviteText } from "../../../lib/huddleInvite";
import { useConversations } from "../../../stores/conversationStore";

/**
 * The sentence the engineer pastes, assembled from what the app already knows:
 * who they are, what the agent is called, and where the room is.
 */
export function useHuddleInvite(
  agentId: string,
  hostName: string,
  url: string | null,
): string {
  const conversations = useConversations();

  return huddleInviteText({
    name: hostName,
    agentTitle: conversations[agentId]?.title ?? "",
    url: url ?? "",
  });
}
