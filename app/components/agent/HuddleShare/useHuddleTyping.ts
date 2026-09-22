import { useEffect, useMemo } from "react";
import { createTypingReporter } from "@argus/peacock";
import { huddleSetTyping } from "../../../lib/ipc";
import { useHuddleRoomForAgent } from "../../../stores/huddleStore";

/**
 * Report the engineer as composing while they type at a shared agent, so the
 * guests see them busy the same way the host sees them. A no-op when the agent
 * isn't shared, which is the common case — the composer calls it either way.
 */
export function useHuddleTyping(agentId: string | null | undefined): {
  keystroke: () => void;
  stop: () => void;
} {
  const roomId = useHuddleRoomForAgent(agentId ?? null)?.id ?? null;

  const reporter = useMemo(
    () =>
      createTypingReporter((typing) => {
        if (roomId) {
          huddleSetTyping(roomId, typing).catch(() => {});
        }
      }),
    [roomId],
  );

  // Leaving the agent — or the huddle ending — must not leave the room showing
  // the host as mid-sentence until the host's own expiry fires.
  useEffect(() => () => reporter.stop(), [reporter]);

  return reporter;
}
