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
  type EndpointKind,
  type RemoteEndpoint,
} from "./endpoints";
import {
  broadcastEndpoints,
  clearConnections,
  getConnectedDeviceIds,
  setConnectionsChangedListener,
} from "./gateway";
import { endAllRooms } from "./huddle";
import { startLocalGateway, stopLocalGateway } from "./localGatewayServer";
import { probeGatewayUrl } from "./reachability";
import {
  getTunnelState,
  markTunnelReachability,
  getTunnelStates,
  onTunnelChange,
  startTunnel,
  stopTunnel,
  subscribeTunnelChange,
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

/**
 * Bind address and static dir are two separate decisions:
 *
 * | LAN web | tunnel | bind      | bundle |
 * | ------- | ------ | --------- | ------ |
 * | off     | off    | 127.0.0.1 | served |
 * | off     | on     | 127.0.0.1 | served |
 * | on      | off    | 0.0.0.0   | served |
 * | on      | on     | 0.0.0.0   | served |
 *
 * Only LAN web widens the bind — a tunnel reaches the gateway over loopback, so
 * binding 0.0.0.0 for it would expose the host on the Wi-Fi nobody asked to be
 * on. Serving the bundle is unconditional instead: over a tunnel the URL *is*
 * the web client, and on loopback-only it reaches no one but this machine. It
 * also has to be decided up front, since a huddle can raise a tunnel later
 * without restarting the server.
 */
function gatewayOpts(): { host: string; staticDir: string | null } {
  return {
    host: loadAppSettings().remote_lan_web ? "0.0.0.0" : "127.0.0.1",
    staticDir: webClientDir,
  };
}

/** Tear down then, if enabled, bring up the local gateway (+ optional tunnel). */
export async function applyRemoteSettings(): Promise<void> {
  stopRemote();

  const settings = loadAppSettings();
  if (!settings.remote_enabled) {
    return;
  }
  const identity = await getDesktopIdentity();

  await startLocalGateway(LOCAL_GATEWAY_PORT, identity, gatewayOpts());

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
  // Rooms are in memory and die with the gateway: end them first so guest
  // grants are revoked and their URL leases handed back before it goes down.
  endAllRooms();
  running = false;
  // Anything we raised is gone with it, and a tunnel that comes back up after a
  // settings change belongs to the user, not to a huddle.
  huddleOwnsCloudflare = false;
  huddleStartedGateway = false;
  setGatewayActive(false);
  stopTunnel();
  stopLocalGateway();
  clearConnections();
}

/**
 * On-demand public URL for huddles. A huddle link only works if some endpoint
 * off this machine reaches the gateway, but remote access may be off entirely,
 * so it can raise a Cloudflare quick tunnel and drop it again afterwards.
 *
 * Reference-counted: overlapping huddles share one tunnel and only the last
 * release tears it down. A tunnel the user enabled in Settings is reused and
 * never stopped here.
 */
const QUICK_TUNNEL_TIMEOUT_MS = 30_000;

let publicUrlRefs = 0;
let huddleOwnsCloudflare = false;
let huddleStartedGateway = false;

export interface PublicUrlLease {
  /** `wss://` gateway address. */
  url: string;
  /** `https://` origin serving the web client — this is the shareable link. */
  webUrl: string;
  kind: EndpointKind;
  /** True when huddles raised this tunnel, so the last release drops it. */
  raised: boolean;
}

function wssToHttps(url: string): string {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

function leaseFor(kind: EndpointKind, url: string): PublicUrlLease {
  return { url, webUrl: wssToHttps(url), kind, raised: huddleOwnsCloudflare };
}

/** Outstanding huddle leases; exported for status and tests. */
export function publicUrlLeaseCount(): number {
  return publicUrlRefs;
}

/** Wait for a provider to publish its URL, or explain why it never will. */
function waitForTunnelUrl(
  provider: TunnelProvider,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null, url?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve(url as string);
      }
    };
    const check = () => {
      const state = getTunnelState(provider);
      if (state.publicUrl) {
        finish(null, state.publicUrl);
      } else if (state.status === "error") {
        finish(new Error(state.error ?? `${provider} tunnel failed`));
      } else if (state.status === "stopped") {
        finish(new Error(`${provider} tunnel stopped before it was reachable`));
      }
    };
    const timer = setTimeout(
      () => finish(new Error(`no URL after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    );
    timer.unref?.();
    const unsubscribe = subscribeTunnelChange(check);
    check();
  });
}

function quickTunnelFailure(reasons: string[]): Error {
  const detail = reasons.filter(Boolean).join("\n");

  return new Error(
    `Couldn't get a public link:\n${detail}\n` +
      "Cloudflare rate-limits and rotates its free quick tunnels. Wait a minute " +
      "and try again, or set up Tailscale or a named Cloudflare tunnel in " +
      "Settings → Remote access for a link that doesn't depend on them.",
  );
}

/** Why a URL that exists still isn't usable, in terms the user can act on. */
function unreachableReason(kind: EndpointKind, url: string): string {
  if (kind === "tailscale") {
    return `Tailscale published ${wssToHttps(url)} but nothing answered through it — this Mac probably isn't connected to your tailnet. Open the Tailscale app and sign in, then try again.`;
  }

  return `${wssToHttps(url)} didn't route back to Argus.`;
}

/**
 * Verify a candidate before handing it to a guest, and record the verdict so
 * Settings can explain a tunnel that looks up but isn't. Publishing a URL and
 * being reachable on it are different things — an offline Tailscale node still
 * prints its funnel hostname, and a link minted from it never loads.
 */
async function confirmReachable(
  kind: EndpointKind,
  url: string,
): Promise<boolean> {
  if (kind === "lan") {
    return true;
  }
  const ok = await probeGatewayUrl(url);
  markTunnelReachability(kind, url, ok, unreachableReason(kind, url));

  return ok;
}

/** The gateway has to be listening before a tunnel has anything to point at. */
async function ensureGatewayUp(): Promise<void> {
  if (running) {
    return;
  }
  const identity = await getDesktopIdentity();
  await startLocalGateway(LOCAL_GATEWAY_PORT, identity, gatewayOpts());
  running = true;
  huddleStartedGateway = true;
  setGatewayActive(true);
  statusListener?.();
}

function stopHuddleGateway(): void {
  huddleStartedGateway = false;
  running = false;
  setGatewayActive(false);
  stopLocalGateway();
  clearConnections();
  statusListener?.();
}

/**
 * Claim a publicly reachable URL, raising a Cloudflare quick tunnel only if
 * nothing already reaches this host. Every successful call must be matched by
 * `releasePublicUrl()`.
 */
export async function acquirePublicUrl(
  opts: { timeoutMs?: number } = {},
): Promise<PublicUrlLease> {
  const timeoutMs = opts.timeoutMs ?? QUICK_TUNNEL_TIMEOUT_MS;
  await ensureGatewayUp();
  const failures: string[] = [];

  // Something may already reach us — the user's own tunnel, a Tailscale funnel,
  // or one an earlier huddle raised — but only if it truly answers. A guest gets
  // one URL and no fallback list, so each candidate is probed before it's used.
  // getEndpoints() ranks Tailscale above Cloudflare.
  for (const candidate of getEndpoints()) {
    if (candidate.kind === "lan") {
      continue;
    }
    if (await confirmReachable(candidate.kind, candidate.url)) {
      publicUrlRefs += 1;

      return leaseFor(candidate.kind, candidate.url);
    }
    failures.push(unreachableReason(candidate.kind, candidate.url));
  }

  // A provider the user enabled is still coming up: wait for it rather than
  // racing a second tunnel onto the same port.
  const pending = enabledProviders().find(
    (p) => isStartable(p) && getTunnelState(p).status === "starting",
  );
  if (pending) {
    try {
      const url = await waitForTunnelUrl(pending, timeoutMs);
      if (await confirmReachable(pending, url)) {
        publicUrlRefs += 1;

        return leaseFor(pending, url);
      }
      failures.push(unreachableReason(pending, url));
    } catch (e) {
      // Fall through: a failing Tailscale funnel is exactly when a quick
      // tunnel earns its keep.
      failures.push(`${pending}: ${(e as Error).message}`);
    }
  }

  // Last resort. Never on top of a Cloudflare tunnel the user configured —
  // starting ours would kill theirs and nothing here would put it back.
  if (
    enabledProviders().includes("cloudflare") &&
    getTunnelState("cloudflare").publicUrl
  ) {
    throw quickTunnelFailure(failures);
  }

  startTunnel({
    provider: "cloudflare",
    localPort: LOCAL_GATEWAY_PORT,
    cloudflareMode: "quick",
  });
  huddleOwnsCloudflare = true;
  try {
    const url = await waitForTunnelUrl("cloudflare", timeoutMs);
    if (!(await confirmReachable("cloudflare", url))) {
      throw new Error(unreachableReason("cloudflare", url));
    }
    publicUrlRefs += 1;

    return leaseFor("cloudflare", url);
  } catch (e) {
    if (publicUrlRefs === 0) {
      huddleOwnsCloudflare = false;
      stopTunnel("cloudflare");
      if (huddleStartedGateway) {
        stopHuddleGateway();
      }
    }
    throw quickTunnelFailure([...failures, (e as Error).message]);
  }
}

/** Drop one lease; the last one takes down whatever the huddles raised. */
export function releasePublicUrl(): void {
  if (publicUrlRefs === 0) {
    return;
  }
  publicUrlRefs -= 1;
  if (publicUrlRefs > 0) {
    return;
  }
  if (huddleOwnsCloudflare) {
    huddleOwnsCloudflare = false;
    stopTunnel("cloudflare");
  }
  if (huddleStartedGateway) {
    stopHuddleGateway();
  }
}
