import { HuddleChat, Icons } from "@argus/peacock";
import { huddleSay } from "../../../lib/ipc";
import { useHuddleRoomForAgent } from "../../../stores/huddleStore";
import styles from "./HuddleChatPanel.module.css";

interface HuddleChatPanelProps {
  agentId: string;
  onClose: () => void;
}

/**
 * The huddle's side chat, docked beside the agent.
 *
 * Beside rather than inside the share dialog: this is a conversation that runs
 * for as long as the huddle does, and a modal you have to reopen to read is a
 * reason to go back to Slack instead.
 */
export function HuddleChatPanel({ agentId, onClose }: HuddleChatPanelProps) {
  const room = useHuddleRoomForAgent(agentId);
  if (!room) {
    return null;
  }

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <Icons.ChatIcon size={12} />
        <span className={styles.title}>Huddle chat</span>
        <button
          aria-label="Close huddle chat"
          className={styles.close}
          title="Close huddle chat"
          onClick={onClose}
        >
          <Icons.CloseIcon size={12} />
        </button>
      </header>
      <HuddleChat
        emptyLabel="Nothing said yet. This stays between the people here — the agent never sees it."
        messages={room.chat.map((m) => ({
          id: m.id,
          author: m.author,
          text: m.text,
          at: m.at,
          mine: m.member_id === null,
        }))}
        onSend={(text) => {
          huddleSay(room.id, text).catch(() => {});
        }}
      />
    </aside>
  );
}
