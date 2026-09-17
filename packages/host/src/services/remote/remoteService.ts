/**
 * Lifecycle for phone/LAN remote access. When enabled, starts the local gateway
 * server and, optionally, a tunnel (Cloudflare or Tailscale) that exposes it
 * off-network. In LAN mode the gateway binds the network interface and serves
 * the web client, so other devices on your Wi-Fi can open it in a browser.
 * Started from `main.ts` and re-applied whenever the settings change.
 */

import { loadAppSettings, saveAppSettings } from "../appSettings/store";
import {
  getDesktopIdentity,
  listDevices,
  onDevicesChanged,
  type PairedDevice,
} from "./deviceStore";
import {
  getEndpoints,
  getLanUrl,
  LOCAL_GATEWAY_PORT,
  setGatewayActive,
  type RemoteEndpoint,
} from "./endpoints";
import {
  broadcastEndpoints,
  clearConnections,
  getConnectedDeviceIds,
  setConnectionsChangedListener,
} from "./gateway";
import { startLocalGateway, stopLocalGateway } from "./localGatewayServer";
import {
  getTunnelStates,
  onTunnelChange,
  startTunnel,
  stopTunnel,
  TUNNEL_PROVIDERS,
  type CloudflareMode,
  type TunnelProvider,
  type TunnelState,
} from "./tunnelManager";

export { getEndpoints, getLanUrl, LOCAL_GATEWAY_PORT };
export type { EndpointKind, RemoteEndpoint } from "./endpoints";

let running = false;
let webClientDir: string | null = null;

/** Set by main.ts at startup with the resolved static web client directory. */
export function setWebClientDir(dir: string | null): void {
  webClientDir = dir;
}

export function isRemoteActive(): boolean {
  return running;
}

/**
 * Which tunnels should be running. Installs that predate concurrent providers
 * only have the old exclusive `remote_provider`, so fold it in as a default.
 */
export function enabledProviders(): TunnelProvider[] {
  const settings = loadAppSettings();
  const legacy = settings.remote_provider;

  return TUNNEL_PROVIDERS.filter((provider) => {
    const flag =
      provider === "tailscale"
        ? settings.remote_tailscale_enabled
        : settings.remote_cloudflare_enabled;

    return flag ?? legacy === provider;
  });
}

/** Cloudflare can't start without a token in named-tunnel mode. */
function isStartable(provider: TunnelProvider): boolean {
  const settings = loadAppSettings();
  if (provider !== "cloudflare") {
    return true;
  }

  return (
    (settings.remote_tunnel_mode ?? "quick") !== "token" ||
    Boolean(settings.remote_tunnel_token)
  );
}

/**
 * Address to seed the pairing payload with. Prefers a tunnel so a QR scanned at
 * home keeps working away from the LAN; the full list is synced after connect.
 */
export function getPublicUrl(): string | null {
  const endpoints = getEndpoints();
  const tunnelled = endpoints.find((e) => e.kind !== "lan");

  return (tunnelled ?? endpoints[0])?.url ?? null;
}

export interface RemoteStatus {
  enabled: boolean;
  /** Independently enabled tunnel providers. */
  tailscaleEnabled: boolean;
  cloudflareEnabled: boolean;
  /** Per-provider runtime state, keyed by provider. */
  tunnels: Record<TunnelProvider, TunnelState>;
  /** Every address a phone could use right now, best first. */
  endpoints: RemoteEndpoint[];
  tunnelMode: CloudflareMode;
  hasTunnelToken: boolean;
  publicUrl: string | null;
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
  const enabled = enabledProviders();
  const lanWebEnabled = Boolean(settings.remote_lan_web);

  return {
    enabled: Boolean(settings.remote_enabled),
    tailscaleEnabled: enabled.includes("tailscale"),
    cloudflareEnabled: enabled.includes("cloudflare"),
    tunnels: getTunnelStates(),
    endpoints: getEndpoints(),
    tunnelMode: settings.remote_tunnel_mode ?? "quick",
    hasTunnelToken: Boolean(settings.remote_tunnel_token),
    publicUrl: getPublicUrl(),
    lanWebEnabled,
    lanUrl: lanWebEnabled && running ? getLanUrl() : null,
    notifyWhenFocused: Boolean(settings.remote_notify_when_focused),
    devices: await listDevices(),
    connectedDeviceIds: getConnectedDeviceIds(),
  };
}

export async function setRemoteConfig(cfg: {
  enabled?: boolean;
  tailscaleEnabled?: boolean;
  cloudflareEnabled?: boolean;
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
  if (cfg.tailscaleEnabled !== undefined) {
    patch.remote_tailscale_enabled = cfg.tailscaleEnabled;
  }
  if (cfg.cloudflareEnabled !== undefined) {
    patch.remote_cloudflare_enabled = cfg.cloudflareEnabled;
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
  // A tunnel coming up or dying changes the routes a phone can take, so tell
  // connected devices as well as the renderer.
  onTunnelChange(
    cb
      ? () => {
          broadcastEndpoints(getEndpoints());
          cb();
        }
      : null,
  );
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

  // Tunnels are optional and independent — LAN mode works with none enabled,
  // and each enabled provider gets its own process.
  const cloudflareMode: CloudflareMode = settings.remote_tunnel_mode ?? "quick";
  for (const provider of enabledProviders()) {
    if (!isStartable(provider)) {
      continue;
    }
    startTunnel({
      provider,
      localPort: LOCAL_GATEWAY_PORT,
      cloudflareMode,
      cloudflareToken: settings.remote_tunnel_token,
      cloudflarePublicUrl: settings.remote_public_url,
    });
  }
  running = true;
  setGatewayActive(true);
  statusListener?.();
}

export function stopRemote(): void {
  running = false;
  setGatewayActive(false);
  stopTunnel();
  stopLocalGateway();
  clearConnections();
}
