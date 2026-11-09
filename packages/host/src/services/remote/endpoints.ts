/**
 * The addresses a phone can reach this desktop on.
 *
 * Routes are live at once: the LAN IP, the tailnet IP and the account's
 * managed tunnel. Clients receive the whole ranked list and keep the simplest
 * one that handshakes.
 *
 * A leaf module on purpose — the gateway's method handlers need this, and
 * importing `remoteService` there would close the
 * `remoteService → gateway → capabilities` import cycle.
 */

import type { TunnelProvider } from "./tunnelManager";
import { networkInterfaces } from "node:os";
import { getManagedTunnelUrl } from "./managedTunnel";
import { getTunnelStates } from "./tunnelManager";

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
 * direct WireGuard mesh, the managed tunnel relays through Cloudflare.
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

export function isGatewayOnLan(): boolean {
  return gatewayOnLan;
}

/** Tailscale hands out addresses from the CGNAT range, 100.64.0.0/10. */
export function isTailnetAddress(address: string): boolean {
  const [a, b] = address.split(".").map(Number);

  return a === 100 && b >= 64 && b <= 127;
}

/**
 * True for a peer that reached the gateway straight over the local network:
 * not loopback (where the tunnels arrive) and not the tailnet (WireGuard
 * already encrypts that hop).
 */
export function isDirectLanPeer(address: string | undefined): boolean {
  const ip = (address ?? "").replace(/^::ffff:/, "");
  if (ip === "" || ip === "::1" || ip.startsWith("127.")) {
    return false;
  }

  return !isTailnetAddress(ip);
}

function ipv4Addresses(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) {
        out.push(a.address);
      }
    }
  }

  return out;
}

/** First non-internal, non-tailnet IPv4 address as a ws:// URL, or null. */
export function getLanUrl(): string | null {
  const address = ipv4Addresses().find((a) => !isTailnetAddress(a));

  return address ? `ws://${address}:${LOCAL_GATEWAY_PORT}` : null;
}

/**
 * This machine's tailnet address as a ws:// URL, or null when Tailscale isn't
 * connected. An IP rather than the MagicDNS name: phones on the tailnet reach
 * it directly, and a bare IP needs no TLS exception on iOS.
 */
export function getTailnetUrl(): string | null {
  const address = ipv4Addresses().find(isTailnetAddress);

  return address ? `ws://${address}:${LOCAL_GATEWAY_PORT}` : null;
}

/**
 * Every address worth trying, best first. Only live ones are included — a
 * tunnel that hasn't registered yet isn't reachable.
 */
export function getEndpoints(): RemoteEndpoint[] {
  const endpoints: RemoteEndpoint[] = [];
  const add = (kind: EndpointKind, url: string | null) => {
    if (url) {
      endpoints.push({ kind, url, priority: ENDPOINT_PRIORITY[kind] });
    }
  };
  const legacy = getTunnelStates();

  if (gatewayOnLan) {
    add("lan", getLanUrl());
  }
  // A phone keeps one address per kind. An earlier version's Funnel reaches
  // phones off the tailnet too, so while it runs it stands in for the direct
  // tailnet address.
  add(
    "tailscale",
    legacy.tailscale.publicUrl ?? (gatewayOnLan ? getTailnetUrl() : null),
  );
  add("cloudflare", getManagedTunnelUrl() ?? legacy.cloudflare.publicUrl);

  return endpoints.sort((a, b) => a.priority - b.priority);
}
