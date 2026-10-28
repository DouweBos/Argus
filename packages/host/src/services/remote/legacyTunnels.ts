/**
 * Tunnels an earlier version let the user configure: a Cloudflare quick or
 * named tunnel, and Tailscale Funnel. They can't be set up any more. One that
 * was keeps running, so a phone that depends on it isn't stranded, until the
 * account's managed tunnel is up — then it's stopped and its settings cleared.
 */

import type { AppSettings } from "../appSettings/store";
import { loadAppSettings, saveAppSettings } from "../appSettings/store";
import { capture } from "../telemetry/telemetry";
import {
  getTunnelState,
  startTunnel,
  stopTunnel,
  type TunnelProvider,
  type TunnelStatus,
} from "./tunnelManager";

export type LegacyTunnelKind =
  | "cloudflare_quick"
  | "cloudflare_token"
  | "tailscale_funnel";

export interface LegacyTunnelState {
  kind: LegacyTunnelKind;
  status: TunnelStatus;
  publicUrl: string | null;
  error: string | null;
}

/** Which tunnels the stored settings ask for, folding in the oldest flag. */
export function legacyProviders(
  settings: AppSettings = loadAppSettings(),
): TunnelProvider[] {
  const old = settings.remote_provider;
  const providers: TunnelProvider[] = [];
  if (settings.remote_tailscale_enabled ?? old === "tailscale") {
    providers.push("tailscale");
  }
  if (settings.remote_cloudflare_enabled ?? old === "cloudflare") {
    // A named tunnel with no token never could start.
    const named = settings.remote_tunnel_mode === "token";
    if (!named || settings.remote_tunnel_token) {
      providers.push("cloudflare");
    }
  }

  return providers;
}

function kindOf(
  provider: TunnelProvider,
  settings: AppSettings,
): LegacyTunnelKind {
  if (provider === "tailscale") {
    return "tailscale_funnel";
  }

  return settings.remote_tunnel_mode === "token"
    ? "cloudflare_token"
    : "cloudflare_quick";
}

export function startLegacyTunnels(localPort: number): void {
  const settings = loadAppSettings();
  for (const provider of legacyProviders(settings)) {
    startTunnel({
      provider,
      localPort,
      cloudflareMode: settings.remote_tunnel_mode ?? "quick",
      cloudflareToken: settings.remote_tunnel_token,
      cloudflarePublicUrl: settings.remote_public_url,
    });
  }
}

export function legacyTunnelStates(): LegacyTunnelState[] {
  const settings = loadAppSettings();

  return legacyProviders(settings).map((provider) => {
    const state = getTunnelState(provider);

    return {
      kind: kindOf(provider, settings),
      status: state.status,
      publicUrl: state.publicUrl,
      error: state.error,
    };
  });
}

const CLEARED: AppSettings = {
  remote_provider: undefined,
  remote_tailscale_enabled: undefined,
  remote_cloudflare_enabled: undefined,
  remote_tunnel_mode: undefined,
  remote_tunnel_token: undefined,
  remote_public_url: undefined,
};

/**
 * Stop every legacy tunnel and forget its settings. A quick tunnel a huddle
 * is holding shares the Cloudflare slot, so the caller says whether to spare it.
 */
export function retireLegacyTunnels(
  reason: "managed" | "user",
  opts: { spareCloudflare?: boolean } = {},
): void {
  const settings = loadAppSettings();
  const providers = legacyProviders(settings);
  const stored = Object.keys(CLEARED).some(
    (key) => settings[key as keyof AppSettings] !== undefined,
  );
  if (!stored) {
    return;
  }
  // Settings first: stopping a tunnel notifies listeners, which may call in
  // here again and must find nothing left to retire.
  saveAppSettings(CLEARED);
  for (const provider of providers) {
    capture("legacy_tunnel_retired", {
      kind: kindOf(provider, settings),
      reason,
    });
    if (provider !== "cloudflare" || !opts.spareCloudflare) {
      stopTunnel(provider);
    }
  }
}
