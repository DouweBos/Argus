/**
 * Pairing (enrollment) wire formats. The QR / short-code carries everything the
 * client needs to authenticate the desktop out-of-band. `pairing_secret` is the
 * anti-MITM anchor — it must travel ONLY via the QR/short-code, never the relay.
 */

import { z } from "zod";

export const PAIRING_HKDF_INFO = "argus-pair-v1";

/** Payload encoded into the pairing QR (JSON) and decodable from a short code. */
export const PairingPayload = z.object({
  v: z.literal(1),
  /** Public `wss://` URL the client connects to (the Cloudflare tunnel). */
  url: z.string(),
  /** Desktop static X25519 public key, base64url. Pins the responder identity. */
  ds_pub: z.string(),
  /** 256-bit out-of-band secret, base64url. Never sent over the wire. */
  pairing_secret: z.string(),
});
export type PairingPayload = z.infer<typeof PairingPayload>;

/**
 * Delivered from desktop to client INSIDE the encrypted pairing handshake. The
 * client is identified on future connections by its pinned static key, so no
 * rendezvous secret is needed — just the granted id + capabilities.
 */
export const PairingGrant = z.object({
  device_id: z.string(),
  capabilities: z.array(z.string()),
  /** This computer's name, so a phone paired with several can tell them apart. */
  host_name: z.string().optional(),
});
export type PairingGrant = z.infer<typeof PairingGrant>;

/** Number of decimal digits in the Short Authentication String. */
export const SAS_DIGITS = 6;
