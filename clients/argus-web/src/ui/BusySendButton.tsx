/**
 * The composer's send button while the agent is mid-turn. A click joins the
 * running turn; right-click (or Alt+Enter in the composer) holds the message
 * until the turn ends.
 */

import { useState } from "react";
import { Button, ContextMenu, Icons } from "@argus/peacock";

export type SendTiming = "now" | "after_turn";

export function BusySendButton({
  onSend,
}: {
  onSend: (timing: SendTiming) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <Button
        variant="send"
        aria-label="Send message"
        title="Send now, joins the current turn (right-click or Alt+Enter to send after this turn)"
        onClick={() => onSend("now")}
        onContextMenu={(e) => {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.right - 240, y: rect.top - 4 });
        }}
      >
        <Icons.SendIcon />
      </Button>
      {menu && (
        <ContextMenu
          placement="above"
          position={menu}
          items={[
            {
              label: "Send now",
              description: "Joins the current turn",
              trailing: "Enter",
              onClick: () => onSend("now"),
            },
            {
              label: "Send after this turn",
              description: "Waits in the queue until the agent is done",
              trailing: "Alt+Enter",
              onClick: () => onSend("after_turn"),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
