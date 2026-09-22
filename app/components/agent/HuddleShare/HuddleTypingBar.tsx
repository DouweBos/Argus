import { TypingIndicator } from "@argus/peacock";
import {
  approvedGuests,
  useHuddleRoomForAgent,
} from "../../../stores/huddleStore";
import styles from "./HuddleTypingBar.module.css";

/**
 * Who in the huddle is composing right now, shown above the engineer's own
 * composer. Renders nothing when the agent isn't shared or nobody is typing,
 * so it costs the unshared case a single row that never appears.
 */
export function HuddleTypingBar({ agentId }: { agentId: string }) {
  const room = useHuddleRoomForAgent(agentId);
  const names = approvedGuests(room)
    .filter((g) => g.typing)
    .map((g) => g.label);

  if (names.length === 0) {
    return null;
  }

  return <TypingIndicator className={styles.bar} names={names} />;
}
