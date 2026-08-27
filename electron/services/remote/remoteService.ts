/**
 * Lifecycle for phone/LAN remote access. When enabled, starts the local gateway
 * server and, optionally, a tunnel (Cloudflare or Tailscale) that exposes it
 * off-network. In LAN mode the gateway binds the network interface and serves
 * the web client, so other devices on your Wi-Fi can open it in a browser.
 * Started from `main.ts` and re-applied whenever the settings change.
 */

import { networkInterfaces } from "node:os";
import { loadAppSettings, saveAppSettings } from "../appSettings/store";
import {
  getDesktopIdentity,
  listDevices,
  onDevicesChanged,
  type PairedDevice,
} from "./deviceStore";
import {
  clearConnections,
  getConnectedDeviceIds,
  setConnectionsChangedListener,
} from "./gateway";
import { startLocalGateway, stopLocalGateway } from "./localGatewayServer";
import {
  getTunnelState,
  onTunnelChange,
  startTunnel,
  stopTunnel,
  type CloudflareMode,
  type TunnelProvider,
} from "./tunnelManager";

/** Provider choice including "none" (LAN only, no tunnel). */
export type RemoteProvider = TunnelProvider | "none";

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

let running = false;
let webClientDir: string | null = null;

/** Set by main.ts at startup with the resolved static web client directory. */
export function setWebClientDir(dir: string | null): void {
  webClientDir = dir;
}

export function isRemoteActive(): boolean {
  return running;
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

/** The tunnel URL if up, else the LAN URL (used to seed the pairing payload). */
export function getPublicUrl(): string | null {
  const tunnel = getTunnelState().publicUrl;
  if (tunnel) {
    return tunnel;
  }

  return loadAppSettings().remote_lan_web ? getLanUrl() : null;
}

export interface RemoteStatus {
  enabled: boolean;
  provider: RemoteProvider;
  tunnelMode: CloudflareMode;
  hasTunnelToken: boolean;
  publicUrl: string | null;
  tunnelStatus: string;
  tunnelError: string | null;
  lanWebEnabled: boolean;
  lanUrl: string | null;
  /** Mirror notifications to devices even while the desktop window is focused. */
  notifyWhenFocused: boolean;
  devices: PairedDevice[];
  /** Device IDs with a live connection right now. */
  connectedDeviceIds: string[];
}

export async function getRemoteStatus(): Promise<RemoteStatus> {
  const settings = loadAppSettings();
  const tunnel = getTunnelState();
  const lanWebEnabled = Boolean(settings.remote_lan_web);

  return {
    enabled: Boolean(settings.remote_enabled),
    provider: settings.remote_provider ?? "none",
    tunnelMode: settings.remote_tunnel_mode ?? "quick",
    hasTunnelToken: Boolean(settings.remote_tunnel_token),
    publicUrl: getPublicUrl(),
    tunnelStatus: tunnel.status,
    tunnelError: tunnel.error,
    lanWebEnabled,
    lanUrl: lanWebEnabled && running ? getLanUrl() : null,
    notifyWhenFocused: Boolean(settings.remote_notify_when_focused),
    devices: await listDevices(),
    connectedDeviceIds: getConnectedDeviceIds(),
  };
}

export async function setRemoteConfig(cfg: {
  enabled?: boolean;
  provider?: RemoteProvider;
  tunnelMode?: CloudflareMode;
  tunnelToken?: string;
  publicUrl?: string;
  lanWeb?: boolean;
  notifyWhenFocused?: boolean;
}): Promise<RemoteStatus> {
  const patch: Parameters<typeof saveAppSettings>[0] = {};
  if (cfg.enabled !== undefined) {
    patch.remote_enabled = cfg.enabled;
  }
  if (cfg.provider !== undefined) {
    patch.remote_provider = cfg.provider;
  }
  if (cfg.tunnelMode !== undefined) {
    patch.remote_tunnel_mode = cfg.tunnelMode;
  }
  if (cfg.tunnelToken !== undefined) {
    patch.remote_tunnel_token = cfg.tunnelToken.trim();
  }
  if (cfg.publicUrl !== undefined) {
    patch.remote_public_url = cfg.publicUrl.trim();
  }
  if (cfg.lanWeb !== undefined) {
    patch.remote_lan_web = cfg.lanWeb;
  }
  if (cfg.notifyWhenFocused !== undefined) {
    patch.remote_notify_when_focused = cfg.notifyWhenFocused;
  }
  if (Object.keys(patch).length > 0) {
    saveAppSettings(patch);
  }
  await applyRemoteSettings();

  return getRemoteStatus();
}

/**
 * Notify the renderer whenever remote status changes — tunnel state, the paired
 * device set (add/rename/revoke), or live device connect/disconnect. Set from
 * ipc.ts.
 */
let statusListener: (() => void) | null = null;
let unsubscribeDevices: (() => void) | null = null;
export function setRemoteStatusListener(cb: (() => void) | null): void {
  statusListener = cb;
  onTunnelChange(cb ? () => cb() : null);
  setConnectionsChangedListener(cb ? () => cb() : null);
  unsubscribeDevices?.();
  unsubscribeDevices = cb ? onDevicesChanged(() => cb()) : null;
}

/** Tear down then, if enabled, bring up the local gateway (+ optional tunnel). */
export async function applyRemoteSettings(): Promise<void> {
  stopRemote();

  const settings = loadAppSettings();
  if (!settings.remote_enabled) {
    return;
  }
  const lanWeb = Boolean(settings.remote_lan_web);
  const identity = await getDesktopIdentity();

  await startLocalGateway(LOCAL_GATEWAY_PORT, identity, {
    host: lanWeb ? "0.0.0.0" : "127.0.0.1",
    staticDir: lanWeb ? webClientDir : null,
  });

  // Off-network access via a tunnel is entirely optional — LAN mode works with
  // no tunnel at all, and "none" never spawns an external process.
  const provider: RemoteProvider = settings.remote_provider ?? "none";
  const cloudflareMode: CloudflareMode = settings.remote_tunnel_mode ?? "quick";
  const needsToken =
    provider === "cloudflare" &&
    cloudflareMode === "token" &&
    !settings.remote_tunnel_token;
  if (provider !== "none" && !needsToken) {
    startTunnel({
      provider,
      localPort: LOCAL_GATEWAY_PORT,
      cloudflareMode,
      cloudflareToken: settings.remote_tunnel_token,
      cloudflarePublicUrl: settings.remote_public_url,
    });
  }
  running = true;
  statusListener?.();
}

export function stopRemote(): void {
  running = false;
  stopTunnel();
  stopLocalGateway();
  clearConnections();
}
