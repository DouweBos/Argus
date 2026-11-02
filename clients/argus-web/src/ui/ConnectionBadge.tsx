import { Badge, Spinner, StatusDot } from "@argus/peacock";
import type { ConnectionState } from "@argus/remote-client";

/**
 * A healthy connection is the normal case and doesn't need saying, so it
 * shrinks to a dot — only trouble gets words. Sized to its content, so it
 * never stretches across the row it sits in.
 */
export function ConnectionBadge({ state }: { state: ConnectionState }) {
  if (state === "ready") {
    return (
      <StatusDot
        aria-label="Connected"
        className="aw-connection-badge"
        role="img"
        tone="success"
      />
    );
  }
  if (state === "offline") {
    return (
      <span className="aw-connection-badge">
        <Badge tone="warning">Reconnecting…</Badge>
      </span>
    );
  }

  return (
    <span className="aw-connection-badge">
      <Spinner size="xs" />
      <Badge tone="neutral">
        {state === "handshaking" ? "Securing" : "Connecting"}
      </Badge>
    </span>
  );
}
