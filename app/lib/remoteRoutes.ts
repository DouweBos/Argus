import type {
  LegacyTunnelKind,
  LegacyTunnelState,
  ManagedTunnelOffReason,
  ManagedTunnelState,
  RemoteStatus,
} from "./types";

export type RouteTone = "error" | "idle" | "success" | "warning";

const OFF_REASONS: Record<ManagedTunnelOffReason, string> = {
  not_linked:
    "Link this computer to an Argus account to get an address that works from anywhere.",
  account_paused: "The account is turned off on this computer.",
  turned_off: "Turned off for this computer.",
  remote_off: "Starts when remote access is on.",
};

const PHASE_LABELS: Record<ManagedTunnelState["phase"], string> = {
  off: "off",
  unavailable: "unavailable",
  provisioning: "setting up",
  installing: "installing",
  starting: "starting",
  running: "running",
  error: "failed",
};

const LEGACY_LABELS: Record<LegacyTunnelKind, string> = {
  cloudflare_quick: "Cloudflare quick tunnel",
  cloudflare_token: "Cloudflare named tunnel",
  tailscale_funnel: "Tailscale Funnel",
};

export function managedTunnelTone(state: ManagedTunnelState): RouteTone {
  switch (state.phase) {
    case "running":
      return "success";
    case "error":
      return "error";
    case "unavailable":
      return "warning";
    case "off":
      return "idle";
    default:
      return "warning";
  }
}

export const managedTunnelLabel = (state: ManagedTunnelState): string =>
  PHASE_LABELS[state.phase];

/** One plain sentence for why the tunnel isn't running, or null when it is. */
export function managedTunnelNote(state: ManagedTunnelState): string | null {
  if (state.phase === "off") {
    return state.reason ? OFF_REASONS[state.reason] : null;
  }
  if (state.phase === "unavailable") {
    return "The account service has no tunnels to hand out right now.";
  }

  return state.phase === "error" ? state.error : null;
}

export const legacyTunnelLabel = (kind: LegacyTunnelKind): string =>
  LEGACY_LABELS[kind];

export function legacyTunnelTone(state: LegacyTunnelState): RouteTone {
  if (state.status === "error") {
    return "error";
  }

  return state.status === "running" ? "success" : "idle";
}

/** Green once any address is live, red when nothing is and a tunnel failed. */
export function reachabilityTone(status: RemoteStatus): RouteTone {
  if (status.endpoints.length > 0) {
    return "success";
  }
  const failed =
    status.managedTunnel.phase === "error" ||
    status.legacyTunnels.some((t) => t.status === "error");

  return failed ? "error" : "idle";
}

export function reachabilityLabel(status: RemoteStatus): string {
  const count = status.endpoints.length;
  if (count > 0) {
    return count === 1 ? "1 way in" : `${count} ways in`;
  }

  return reachabilityTone(status) === "error" ? "unreachable" : "starting";
}
