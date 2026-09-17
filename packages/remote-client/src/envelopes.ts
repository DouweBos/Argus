/**
 * Wire envelopes the client speaks — a plain-TS mirror of
 * `@argus/remote-protocol`'s zod schemas (no runtime validation on the client
 * hot path). Any change here must match the desktop or the two stop talking.
 */

export interface RequestEnvelope {
  type: "req";
  seq: number;
  id: string;
  /** Dotted allowlist method (`agents.spawn`) or, for admin devices, a raw IPC command (`start_agent`). */
  method: string;
  params: unknown;
}

export interface ResponseEnvelope {
  type: "res";
  seq: number;
  id: string;
  ok?: unknown;
  error?: { code: string; message: string; data?: unknown };
}

export interface SubscribeEnvelope {
  type: "sub";
  seq: number;
  action: "subscribe" | "unsubscribe";
  agent_id: string;
}

export interface EventEnvelope {
  type: "evt";
  seq: number;
  event: string;
  agent_id?: string | null;
  payload: unknown;
}

export type Envelope =
  | EventEnvelope
  | RequestEnvelope
  | ResponseEnvelope
  | SubscribeEnvelope;

/** Plaintext tag distinguishing JSON envelopes from binary media frames. */
export const TAG_JSON = 0x00;
export const TAG_MEDIA = 0x01;

/** Pairing code payload, as encoded in the desktop's QR / pasteable code. */
export interface PairingPayload {
  v: 1;
  url: string;
  ds_pub: string;
  pairing_secret: string;
}

/** What the host sends back once the user confirms the SAS. */
export interface PairingGrant {
  device_id: string;
  capabilities: string[];
}
