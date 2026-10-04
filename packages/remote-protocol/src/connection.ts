/**
 * Connection-level methods: transport machinery that changes how this socket
 * is served, so — like `transfer.*` and `huddle.*` — they're answered on the
 * connection itself and never reach the command registry.
 */

import { z } from "zod";

/**
 * Admin-only. Switches a raw (admin) connection to the console's event shaping:
 * typed agent/session/notification events plus raw broadcasts minus the agent
 * kinds the typed dialect already carries. Tiers are unchanged. Returns `{}`.
 */
export const CONNECTION_TYPED_EVENTS = "connection.typed_events";

export const ConnectionTypedEventsParams = z.object({ on: z.boolean() });
export type ConnectionTypedEventsParams = z.infer<
  typeof ConnectionTypedEventsParams
>;
