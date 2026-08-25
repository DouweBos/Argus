/** Header badge reflecting the encrypted channel's state. */

import { Badge, Row, Spinner } from "./ui";
import type { ConnectionState } from "../lib/transport";

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  if (state === "ready") {
    return <Badge label="Connected" tone="success" />;
  }
  if (state === "offline") {
    return <Badge label="Reconnecting" tone="warning" />;
  }

  return (
    <Row gap={5}>
      <Spinner />
      <Badge label={state === "handshaking" ? "Securing" : "Connecting"} />
    </Row>
  );
}
