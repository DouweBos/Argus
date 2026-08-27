/**
 * Header indicator for the encrypted channel.
 *
 * Always the same 7px dot, whatever the state. That is deliberate: this sits
 * in a navigation-bar capsule that sizes itself to the widest content it has
 * measured, so a badge that grew to "Connecting" and then shrank to a dot left
 * the capsule stuck at its widest, trailing a band of dead space. A fixed-width
 * indicator can't do that. The offline case still gets words — from the banner
 * on the screen itself, which has room for them.
 */

import { StatusDot } from "./ui";
import type { ConnectionState } from "../lib/transport";
import type { Tone } from "./ui";

const DOT = 7;
/** IconBtn centres a 16px glyph in a 32px box; match that air either side. */
const ICON_PADDING = 8;

const TONE: Record<ConnectionState, Tone> = {
  ready: "success",
  offline: "warning",
  connecting: "muted",
  handshaking: "muted",
};

const LABEL: Record<ConnectionState, string> = {
  ready: "Connected",
  offline: "Reconnecting",
  connecting: "Connecting",
  handshaking: "Securing",
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <StatusDot
      tone={TONE[state]}
      size={DOT}
      pulse={state !== "ready"}
      accessibilityLabel={LABEL[state]}
      style={{ marginHorizontal: ICON_PADDING }}
    />
  );
}
