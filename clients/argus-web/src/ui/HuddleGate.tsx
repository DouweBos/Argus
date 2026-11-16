/**
 * Everything a huddle guest sees before (and instead of) the huddle itself.
 *
 * A pending guest holds no grants, so there is genuinely nothing to preview —
 * not the agent, not the device, not even which agent they are waiting for.
 * These screens say that plainly rather than faking a loading state.
 */

import type { ReactNode } from "react";
import {
  Button,
  EmptyState,
  HuddleJoin,
  HuddleJoinShell,
  Icons,
} from "@argus/peacock";
import type { HuddleState } from "../lib/huddleSession";

export interface HuddleGateProps {
  state: HuddleState;
  /** Whether the guest has given a name and asked to be let in. */
  asked: boolean;
  defaultLabel?: string;
  onJoin: (label: string) => void;
  /** The huddle proper, rendered once the host approves. */
  children: ReactNode;
}

export function HuddleGate({
  state,
  asked,
  defaultLabel = "",
  onJoin,
  children,
}: HuddleGateProps) {
  if (state === "approved") {
    return <>{children}</>;
  }

  if (state === "denied") {
    return (
      <HuddleJoinShell>
        <EmptyState
          icon={<Icons.LockIcon size={22} />}
          title="Not let in"
          body="The host turned down this request. Ask them for a new link if that wasn't what they meant to do."
        />
      </HuddleJoinShell>
    );
  }

  if (state === "left") {
    return (
      <HuddleJoinShell>
        <EmptyState
          icon={<Icons.GuestsIcon size={22} />}
          title="You left the huddle"
          body="Nothing is being shared with you any more. The host has to let you back in."
          action={
            <Button variant="primary" onClick={() => onJoin(defaultLabel)}>
              Ask to rejoin
            </Button>
          }
        />
      </HuddleJoinShell>
    );
  }

  if (state === "ended") {
    return (
      <HuddleJoinShell>
        <EmptyState
          icon={<Icons.GuestsIcon size={22} />}
          title="The huddle ended"
          body="The host closed it. Your access is gone with it — ask for a new link to join another."
        />
      </HuddleJoinShell>
    );
  }

  if (state === "unavailable") {
    return (
      <HuddleJoinShell>
        <EmptyState
          icon={<Icons.LinkIcon size={22} />}
          title="This link is no longer live"
          body="The huddle it points to has ended or expired. Ask the host to share a new one."
        />
      </HuddleJoinShell>
    );
  }

  if (!asked) {
    return (
      <HuddleJoinShell>
        <HuddleJoin name={defaultLabel} step="name" onJoin={onJoin} />
      </HuddleJoinShell>
    );
  }

  return (
    <HuddleJoinShell>
      <HuddleJoin
        name={defaultLabel}
        step={state === "pending" ? "waiting" : "connecting"}
      />
    </HuddleJoinShell>
  );
}
