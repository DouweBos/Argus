/**
 * The addresses a phone can reach this desktop on.
 *
 * Providers run concurrently, so there's rarely one "current" URL: the LAN IP,
 * a Tailscale funnel and a Cloudflare tunnel can all be live at once. Clients
 * receive the whole ranked list and keep the simplest one that handshakes.
 *
 * A leaf module on purpose — the gateway's method handlers need this, and
 * importing `remoteService` there would close the
 * `remoteService → gateway → capabilities` import cycle.
 */

import type { TunnelProvider } from "./tunnelManager";
import { networkInterfaces } from "node:os";
import { getTunnelStates, TUNNEL_PROVIDERS } from "./tunnelManager";

/**
 * Loopback/LAN port the gateway (and the web client it serves) listens on.
 * Overridable via `ARGUS_REMOTE_PORT` — `pnpm dev` sets it to 47616 so a dev
 * instance and an installed release can run side by side without fighting over
 * the socket.
 */
export const LOCAL_GATEWAY_PORT = parseInt(
  process.env.ARGUS_REMOTE_PORT ?? "47615",
  10,
);

export type EndpointKind = TunnelProvider | "lan";

export interface RemoteEndpoint {
  kind: EndpointKind;
  url: string;
  /** Lower wins. Clients probe all and keep the best-ranked success. */
  priority: number;
}

/**
 * Ranked simplest-first: the LAN never leaves the building, Tailscale is a
 * direct WireGuard mesh, Cloudflare relays through a third party.
 */
const ENDPOINT_PRIORITY: Record<EndpointKind, number> = {
  lan: 0,
  tailscale: 1,
  cloudflare: 2,
};

/** Whether the gateway is listening on the local network; owned by remoteService. */
let gatewayOnLan = false;

const lanListeners = new Set<() => void>();

export function setGatewayOnLan(onLan: boolean): void {
  if (gatewayOnLan === onLan) {
    return;
  }
  gatewayOnLan = onLan;
  for (const cb of lanListeners) {
    cb();
  }
}

/** Notified when the gateway starts or stops listening on the LAN. */
export function onLanChange(cb: () => void): () => void {
  lanListeners.add(cb);

  return () => {
    lanListeners.delete(cb);
  };
}

/** First non-internal IPv4 LAN address as a ws:// URL, or null. */
export function getLanUrl(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) {
        return `ws://${a.address}:${LOCAL_GATEWAY_PORT}`;
      }
    }
  }

  return null;
}

/**
 * Every address worth trying, best first. Only live ones are included — a
 * tunnel that hasn't produced a URL yet isn't reachable.
 */
export function getEndpoints(): RemoteEndpoint[] {
  const endpoints: RemoteEndpoint[] = [];

  if (gatewayOnLan) {
    const lan = getLanUrl();
    if (lan) {
      endpoints.push({
        kind: "lan",
        url: lan,
        priority: ENDPOINT_PRIORITY.lan,
      });
    }
  }

  const states = getTunnelStates();
  for (const provider of TUNNEL_PROVIDERS) {
    const url = states[provider].publicUrl;
    if (url) {
      endpoints.push({
        kind: provider,
        url,
        priority: ENDPOINT_PRIORITY[provider],
      });
    }
  }

  return endpoints.sort((a, b) => a.priority - b.priority);
}
