/**
 * Device hosts as a paired client lists them: other Macs over SSH and EAS
 * Simulator hosts. The TS twin of iOS's `DeviceHostsSettingsPage` rows.
 */

import type { RemoteDeviceHost } from "@argus/remote-protocol";

export type DeviceHostTone = "error" | "neutral" | "success" | "warning";

export interface DeviceHostView {
  id: string;
  label: string;
  kind: "eas" | "ssh";
  /** "Connected", or for EAS "EAS · 1 of 2 running". */
  statusLabel: string;
  tone: DeviceHostTone;
  /** EAS only: sessions running or starting, and the host's limit. */
  running: number;
  limit: number;
  /** EAS at its limit: starting another would be refused. */
  full: boolean;
}

const STATUS_LABEL: Record<RemoteDeviceHost["status"], string> = {
  connected: "Connected",
  unreachable: "Unreachable",
  unknown: "Not checked yet",
};

function toneOf(
  host: RemoteDeviceHost,
  kind: "eas" | "ssh",
  running: number,
): DeviceHostTone {
  if (host.status === "unreachable") {
    return "warning";
  }
  const live = kind === "eas" ? running > 0 : host.status === "connected";

  return live ? "success" : "neutral";
}

export function deviceHostView(host: RemoteDeviceHost): DeviceHostView {
  const kind = host.kind ?? "ssh";
  const running = host.running_sessions ?? 0;
  const limit = host.max_sessions ?? 0;
  const eas = kind === "eas";

  return {
    id: host.id,
    label: host.label,
    kind,
    statusLabel: eas
      ? `EAS · ${String(running)} of ${String(limit)} running`
      : STATUS_LABEL[host.status],
    tone: toneOf(host, kind, running),
    running,
    limit,
    full: eas && running >= limit,
  };
}
