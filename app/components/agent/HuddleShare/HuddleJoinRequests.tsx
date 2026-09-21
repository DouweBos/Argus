import { Button, CalloutCard, IconBadge, Icons } from "@argus/peacock";
import { huddleApproveGuest, huddleDenyGuest } from "../../../lib/ipc";
import { useConversations } from "../../../stores/conversationStore";
import { pendingGuests, useHuddleRooms } from "../../../stores/huddleStore";
import styles from "./HuddleJoinRequests.module.css";

/**
 * "{label} wants to join — Allow / Deny", above whichever agent is on screen.
 *
 * Deliberately not scoped to the active agent and not inside the share dialog:
 * someone arriving mid-huddle must not depend on the engineer still looking at
 * the agent they shared. One card per person, so three arriving at once is
 * three decisions rather than a queue that hides two of them.
 */
export function HuddleJoinRequests() {
  const rooms = useHuddleRooms();
  const conversations = useConversations();

  const requests = rooms.flatMap((room) =>
    pendingGuests(room).map((guest) => ({ guest, room })),
  );

  if (requests.length === 0) {
    return null;
  }

  return (
    <div className={styles.stack}>
      {requests.map(({ guest, room }) => {
        const agentTitle = conversations[room.agent_id]?.title?.trim();

        return (
          <CalloutCard
            key={`${room.id}:${guest.dev_static_pub}`}
            tone="accent"
            leading={
              <IconBadge tone="accent">
                <Icons.GuestsIcon size={14} />
              </IconBadge>
            }
            title={
              agentTitle
                ? `${guest.label} wants to join “${agentTitle}”`
                : `${guest.label} wants to join`
            }
            meta="They'll see this agent's whole conversation, can answer its tool prompts, and can drive the shared device."
            actions={
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    huddleDenyGuest(room.id, guest.dev_static_pub).catch(
                      () => {},
                    );
                  }}
                >
                  Deny
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    huddleApproveGuest(room.id, guest.dev_static_pub).catch(
                      () => {},
                    );
                  }}
                >
                  Allow
                </Button>
              </>
            }
          />
        );
      })}
    </div>
  );
}
