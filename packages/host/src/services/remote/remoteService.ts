/**
 * Lifecycle for phone/LAN remote access. When enabled, starts the local gateway
 * server on the network interface, so devices on your Wi-Fi (or tailnet) reach
 * it directly and the account's managed tunnel has something to forward to.
 * Started from `main.ts` and re-applied whenever the settings change.
 */

import { loadAppSettings, saveAppSettings } from "../appSettings/store";
import { CloudflaredInstallError, ensureCloudflared } from "./cloudflared";
import {
  getDesktopIdentity,
  listDevices,
  onDevicesChanged,
  type PairedDevice,
} from "./deviceStore";
import {
  getEndpoints,
  getLanUrl,
  getTailnetUrl,
  LOCAL_GATEWAY_PORT,
  setGatewayOnLan,
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
import {
  legacyTunnelStates,
  retireLegacyTunnels,
  startLegacyTunnels,
  type LegacyTunnelState,
} from "./legacyTunnels";
import {
  startLocalGateway,
  stopLocalGateway,
  type LocalGatewayOpts,
} from "./localGatewayServer";
import {
  getManagedTunnelState,
  type ManagedTunnelState,
} from "./managedTunnel";
import {
  probeGatewayUrl,
  QUICK_TUNNEL_RETRY_DELAYS_MS,
  type ProbeOpts,
} from "./reachability";
import { cloudflaredMissingError, quickTunnelError } from "./shareError";
import {
  getTunnelState,
  markTunnelReachability,
  onTunnelChange,
  startTunnel,
  stopTunnel,
  subscribeTunnelChange,
  type TunnelProvider,
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

const SEED_ORDER: EndpointKind[] = ["cloudflare", "tailscale", "lan"];

/**
 * Address to seed the pairing payload with. Prefers the tunnel, so a QR
 * scanned at home keeps working away from the LAN; the full list is synced
 * after connect.
 */
export function getPublicUrl(): string | null {
  const endpoints = getEndpoints();
  for (const kind of SEED_ORDER) {
    const found = endpoints.find((e) => e.kind === kind);
    if (found) {
      return found.url;
    }
  }

  return null;
}

export interface RemoteStatus {
  enabled: boolean;
  /** Every address a phone could use right now, best first. */
  endpoints: RemoteEndpoint[];
  publicUrl: string | null;
  lanUrl: string | null;
  /** This computer's tailnet address, when Tailscale is connected. */
  tailscaleUrl: string | null;
  managedTunnel: ManagedTunnelState;
  /** Tunnels configured by an earlier version, still running until replaced. */
  legacyTunnels: LegacyTunnelState[];
  /** Mirror notifications to devices even while the desktop window is focused. */
  notifyWhenFocused: boolean;
  /** Serve the web client to browsers connecting straight over the local network. */
  lanWebClient?: boolean;
  devices: PairedDevice[];
  /** Device IDs with a live connection right now. */
  connectedDeviceIds: string[];
}

export async function getRemoteStatus(): Promise<RemoteStatus> {
  const settings = loadAppSettings();
  const endpoints = getEndpoints();

  return {
    enabled: Boolean(settings.remote_enabled),
    endpoints,
    publicUrl: getPublicUrl(),
    lanUrl: endpoints.find((e) => e.kind === "lan")?.url ?? null,
    tailscaleUrl: running ? getTailnetUrl() : null,
    managedTunnel: getManagedTunnelState(),
    legacyTunnels: running ? legacyTunnelStates() : [],
    notifyWhenFocused: Boolean(settings.remote_notify_when_focused),
    lanWebClient: Boolean(settings.remote_lan_web_client),
    devices: await listDevices(),
    connectedDeviceIds: getConnectedDeviceIds(),
  };
}

export async function setRemoteConfig(cfg: {
  enabled?: boolean;
  notifyWhenFocused?: boolean;
  lanWebClient?: boolean;
  retireLegacyTunnels?: boolean;
}): Promise<RemoteStatus> {
  const patch: Parameters<typeof saveAppSettings>[0] = {};
  if (cfg.enabled !== undefined) {
    patch.remote_enabled = cfg.enabled;
  }
  if (cfg.notifyWhenFocused !== undefined) {
    patch.remote_notify_when_focused = cfg.notifyWhenFocused;
  }
  if (cfg.lanWebClient !== undefined) {
    patch.remote_lan_web_client = cfg.lanWebClient;
  }
  if (Object.keys(patch).length > 0) {
    saveAppSettings(patch);
  }
  if (cfg.retireLegacyTunnels) {
    retireLegacyTunnels("user", { spareCloudflare: huddleOwnsCloudflare });
  }
  // Only the master switch changes what runs; the other preferences are read
  // per request, so they mustn't bounce the gateway under connected phones.
  if (cfg.enabled !== undefined) {
    await applyRemoteSettings();
  } else {
    statusListener?.();
  }

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
 * Remote access listens on the local network so devices there connect directly
 * by IP; tunnels are for everyone else. A huddle shared with remote access off
 * stays on loopback — its guests only ever arrive through a tunnel. Over a
 * tunnel or the tailnet the URL *is* the web client; a direct local-network
 * browser gets it only once the user opts in.
 */
function gatewayOpts(onLan: boolean): LocalGatewayOpts {
  return {
    host: onLan ? "0.0.0.0" : "127.0.0.1",
    staticDir: webClientDir,
    lanWebClient: () => Boolean(loadAppSettings().remote_lan_web_client),
  };
}

/** Tear down then, if enabled, bring up the local gateway. */
export async function applyRemoteSettings(): Promise<void> {
  stopRemote();

  const settings = loadAppSettings();
  if (!settings.remote_enabled) {
    return;
  }
  const identity = await getDesktopIdentity();

  await startLocalGateway(LOCAL_GATEWAY_PORT, identity, gatewayOpts(true));
  if (getManagedTunnelState().phase !== "running") {
    startLegacyTunnels(LOCAL_GATEWAY_PORT);
  }
  running = true;
  setGatewayOnLan(true);
  statusListener?.();
}

/**
 * The managed tunnel replaces whatever an earlier version configured: once it
 * is up, those are stopped and their settings dropped for good.
 */
subscribeTunnelChange(() => {
  if (getManagedTunnelState().phase === "running") {
    retireLegacyTunnels("managed", { spareCloudflare: huddleOwnsCloudflare });
  }
});

export function stopRemote(): void {
  // Rooms are in memory and die with the gateway: end them first so guest
  // grants are revoked and their URL leases handed back before it goes down.
  endAllRooms();
  running = false;
  // Anything we raised is gone with it, and a tunnel that comes back up after a
  // settings change belongs to the user, not to a huddle.
  huddleOwnsCloudflare = false;
  huddleStartedGateway = false;
  setGatewayOnLan(false);
  stopTunnel();
  stopLocalGateway();
  clearConnections();
}

/**
 * On-demand public URL for huddles. A huddle link only works if some endpoint
 * off this machine reaches the gateway, but remote access may be off entirely
 * and a computer with no account has no managed tunnel, so it can raise a
 * Cloudflare quick tunnel and drop it again afterwards.
 *
 * Reference-counted: overlapping huddles share one tunnel and only the last
 * release tears it down. The managed tunnel, or one an earlier version set up,
 * is reused and never stopped here.
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

function quickTunnelFailure(reasons: string[], missing: boolean): Error {
  const detail = reasons.filter(Boolean).join("\n");
  // A missing binary has one fix and reads nothing like a flaky tunnel, so it
  // gets its own explanation rather than the rate-limit one.
  if (missing) {
    return cloudflaredMissingError(detail || undefined);
  }

  return quickTunnelError(detail);
}

/** Why a URL that exists still isn't usable, in terms the user can act on. */
function unreachableReason(kind: EndpointKind, url: string): string {
  if (kind === "tailscale") {
    return `Tailscale Funnel published ${wssToHttps(url)} but nothing answered through it — this Mac probably isn't connected to your tailnet.`;
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
  probe?: ProbeOpts,
): Promise<boolean> {
  if (kind === "lan") {
    return true;
  }
  const ok = await probeGatewayUrl(url, probe);
  markTunnelReachability(kind, url, ok, unreachableReason(kind, url));

  return ok;
}

/** The gateway has to be listening before a tunnel has anything to point at. */
async function ensureGatewayUp(): Promise<void> {
  if (running) {
    return;
  }
  const identity = await getDesktopIdentity();
  await startLocalGateway(LOCAL_GATEWAY_PORT, identity, gatewayOpts(false));
  running = true;
  huddleStartedGateway = true;
  statusListener?.();
}

function stopHuddleGateway(): void {
  huddleStartedGateway = false;
  running = false;
  setGatewayOnLan(false);
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

  // Something may already reach us — the managed tunnel, one an earlier
  // version set up, or one an earlier huddle raised — but only if it truly
  // answers. A guest gets one URL and no fallback list, so each candidate is
  // probed first. Only `wss://` counts: a guest's browser can't reach a LAN
  // or tailnet address.
  for (const candidate of getEndpoints()) {
    if (!candidate.url.startsWith("wss://")) {
      continue;
    }
    if (await confirmReachable(candidate.kind, candidate.url)) {
      publicUrlRefs += 1;

      return leaseFor(candidate.kind, candidate.url);
    }
    failures.push(unreachableReason(candidate.kind, candidate.url));
  }

  // A tunnel already on its way up: wait for it rather than racing a second
  // one onto the same port.
  const pending = (["tailscale", "cloudflare"] as TunnelProvider[]).find(
    (p) => getTunnelState(p).status === "starting",
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
      // Fall through: a failing Funnel is exactly when a quick tunnel earns
      // its keep.
      failures.push(`${pending}: ${(e as Error).message}`);
    }
  }

  // Last resort. Never on top of a Cloudflare tunnel that is already up —
  // starting ours would kill it and nothing here would put it back.
  if (getTunnelState("cloudflare").publicUrl) {
    throw quickTunnelFailure(failures, false);
  }

  let bin: string;
  try {
    bin = (await ensureCloudflared()).path;
  } catch (e) {
    if (publicUrlRefs === 0 && huddleStartedGateway) {
      stopHuddleGateway();
    }
    const reason = e instanceof CloudflaredInstallError ? e.message : String(e);
    throw quickTunnelFailure([...failures, reason], true);
  }
  startTunnel({
    provider: "cloudflare",
    localPort: LOCAL_GATEWAY_PORT,
    cloudflareMode: "quick",
    bin,
  });
  huddleOwnsCloudflare = true;
  try {
    const url = await waitForTunnelUrl("cloudflare", timeoutMs);
    const fresh = {
      awaitPublicDns: true,
      retryDelaysMs: QUICK_TUNNEL_RETRY_DELAYS_MS,
    };
    if (!(await confirmReachable("cloudflare", url, fresh))) {
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
    throw quickTunnelFailure([...failures, (e as Error).message], false);
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
