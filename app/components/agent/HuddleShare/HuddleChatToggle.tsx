import { Icons, useUnreadCount } from "@argus/peacock";
import { useHuddleRoomForAgent } from "../../../stores/huddleStore";
import styles from "./HuddleChatToggle.module.css";

interface HuddleChatToggleProps {
  agentId: string;
  onToggle: () => void;
  open: boolean;
}

/**
 * Open the huddle's side chat, with a count of what has been said since it was
 * last read. Absent entirely when the agent isn't shared — there is nobody to
 * talk to, and an always-present button would imply otherwise.
 */
export function HuddleChatToggle({
  agentId,
  open,
  onToggle,
}: HuddleChatToggleProps) {
  const room = useHuddleRoomForAgent(agentId);
  const unread = useUnreadCount(room?.chat.length ?? 0, open);

  if (!room) {
    return null;
  }

  return (
    <button
      className={[styles.button, open ? styles.open : ""]
        .filter(Boolean)
        .join(" ")}
      title="Huddle chat — just the people here, not the agent"
      onClick={onToggle}
    >
      <Icons.ChatIcon size={12} />
      Chat
      {unread > 0 && <span className={styles.count}>{unread}</span>}
    </button>
  );
}
