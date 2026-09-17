import { Badge, Spinner, StatusBulb } from "@argus/peacock";
import type { ConnectionState } from "@argus/remote-client";

/**
 * A healthy connection is the normal case and doesn't need saying, so it
 * shrinks to a dot — only trouble gets words.
 */
export function ConnectionBadge({ state }: { state: ConnectionState }) {
  if (state === "ready") {
    return (
      <StatusBulb
        tone="success"
        size="sm"
        aria-label="Connected"
        className="aw-header-dot"
      />
    );
  }
  if (state === "offline") {
    return <Badge tone="warning">Reconnecting…</Badge>;
  }

  return (
    <span className="aw-inline">
      <Spinner size="xs" />
      <Badge tone="neutral">
        {state === "handshaking" ? "Securing" : "Connecting"}
      </Badge>
    </span>
  );
}
