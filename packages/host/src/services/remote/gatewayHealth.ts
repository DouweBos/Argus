/**
 * The gateway's liveness probe: a fixed path plus a per-process nonce.
 *
 * A tunnel can publish a URL long before (or without ever) becoming reachable —
 * `tailscale funnel` prints the node's `*.ts.net` name the moment it starts,
 * even when the machine isn't connected to the tailnet. Probing this endpoint
 * is how a caller tells "there is a URL" from "the URL reaches us". The nonce
 * makes the answer unforgeable by a relay or captive portal that happens to
 * return 200 for anything.
 *
 * A leaf module so the probe doesn't have to import the gateway server.
 */

import { randomUUID } from "node:crypto";

export const HEALTH_PATH = "/__argus/health";

const nonce = randomUUID();

/** Identifies this gateway process; changes on every restart. */
export function getGatewayNonce(): string {
  return nonce;
}

export function healthBody(): string {
  return JSON.stringify({ argus: true, nonce });
}
