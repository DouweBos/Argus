/**
 * Everything a huddle guest sees before (and instead of) the huddle itself.
 *
 * A pending guest holds no grants, so there is genuinely nothing to preview —
 * not the agent, not the device, not even which agent they are waiting for.
 * These screens say that plainly rather than faking a loading state.
 */

import { type ReactNode, useState } from "react";
import { Button, EmptyState, Icons, Input, Spinner } from "@argus/peacock";
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
  const [label, setLabel] = useState(defaultLabel);

  if (state === "approved") {
    return <>{children}</>;
  }

  if (state === "denied") {
    return (
      <Shell>
        <EmptyState
          icon={<Icons.LockIcon size={22} />}
          title="Not let in"
          body="The host turned down this request. Ask them for a new link if that wasn't what they meant to do."
        />
      </Shell>
    );
  }

  if (state === "left") {
    return (
      <Shell>
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
      </Shell>
    );
  }

  if (state === "ended") {
    return (
      <Shell>
        <EmptyState
          icon={<Icons.GuestsIcon size={22} />}
          title="The huddle ended"
          body="The host closed it. Your access is gone with it — ask for a new link to join another."
        />
      </Shell>
    );
  }

  if (state === "unavailable") {
    return (
      <Shell>
        <EmptyState
          icon={<Icons.LinkIcon size={22} />}
          title="This link is no longer live"
          body="The huddle it points to has ended or expired. Ask the host to share a new one."
        />
      </Shell>
    );
  }

  if (!asked) {
    return (
      <Shell>
        <div className="aw-card">
          <p className="aw-muted">
            You've been invited to a huddle. The host sees your name when they
            decide whether to let you in.
          </p>
          <Input
            autoFocus
            placeholder="Your name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && label.trim()) {
                onJoin(label.trim());
              }
            }}
          />
          <div>
            <Button
              variant="primary"
              disabled={!label.trim()}
              onClick={() => onJoin(label.trim())}
            >
              Ask to join
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="aw-center">
        <Spinner />
        <p className="aw-muted">
          {state === "pending"
            ? "Waiting for the host to let you in. Nothing is shared until they do — you'll drop straight into the huddle when they approve."
            : "Connecting to the huddle…"}
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="aw-shell">
      <header className="aw-hero">
        <Icons.ArgusLogo size={24} />
        <h1 className="aw-title">Argus huddle</h1>
      </header>
      {children}
    </div>
  );
}
