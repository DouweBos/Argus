import { useState } from "react";
import { Icons, StatusBulb } from "@argus/peacock";
import {
  pendingGuests,
  useHuddleRoomForAgent,
} from "../../../stores/huddleStore";
import { HuddleDialog } from "./HuddleDialog";
import styles from "./ShareAgentButton.module.css";

interface ShareAgentButtonProps {
  agentId: string;
  sessionId: string;
}

/**
 * Share the agent this view is showing. Once a room is live the same button is
 * the way back into it — the link, the guest list and End huddle all live
 * behind it, so there is one place to look.
 */
export function ShareAgentButton({
  agentId,
  sessionId,
}: ShareAgentButtonProps) {
  const [open, setOpen] = useState(false);
  const room = useHuddleRoomForAgent(agentId);
  const waiting = pendingGuests(room).length;

  let title = "Share this agent in a huddle";
  if (room) {
    title =
      waiting > 0
        ? `${waiting} ${waiting === 1 ? "person wants" : "people want"} to join`
        : "Sharing this agent";
  }

  return (
    <>
      <button
        className={[styles.button, room ? styles.live : ""]
          .filter(Boolean)
          .join(" ")}
        title={title}
        onClick={() => setOpen(true)}
      >
        {room ? (
          <StatusBulb size="sm" tone="success" />
        ) : (
          <Icons.ShareIcon size={12} />
        )}
        {room ? "Sharing" : "Share"}
        {waiting > 0 && <span className={styles.count}>{waiting}</span>}
      </button>
      {open && (
        <HuddleDialog
          agentId={agentId}
          sessionId={sessionId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
