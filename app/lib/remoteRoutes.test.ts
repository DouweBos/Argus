import type { ManagedTunnelState, RemoteStatus } from "./types";
import { describe, expect, it } from "vitest";
import {
  managedTunnelNote,
  managedTunnelTone,
  reachabilityLabel,
  reachabilityTone,
} from "./remoteRoutes";

const tunnel = (over: Partial<ManagedTunnelState>): ManagedTunnelState => ({
  phase: "off",
  reason: null,
  url: null,
  error: null,
  ...over,
});

function status(over: Partial<RemoteStatus> = {}): RemoteStatus {
  return {
    enabled: true,
    endpoints: [],
    publicUrl: null,
    lanUrl: null,
    tailscaleUrl: null,
    managedTunnel: tunnel({}),
    legacyTunnels: [],
    notifyWhenFocused: false,
    devices: [],
    connectedDeviceIds: [],
    ...over,
  };
}

describe("remote routes copy", () => {
  it("explains why the managed tunnel is off in plain words", () => {
    expect(
      managedTunnelNote(tunnel({ phase: "off", reason: "not_linked" })),
    ).toMatch(/Link this computer/);
    expect(
      managedTunnelNote(tunnel({ phase: "off", reason: "remote_off" })),
    ).toMatch(/remote access is on/);
  });

  it("shows the error only when the tunnel failed", () => {
    expect(managedTunnelNote(tunnel({ phase: "error", error: "boom" }))).toBe(
      "boom",
    );
    expect(managedTunnelNote(tunnel({ phase: "running" }))).toBeNull();
    expect(managedTunnelTone(tunnel({ phase: "running" }))).toBe("success");
  });

  it("counts the ways in, and calls it unreachable only after a failure", () => {
    const lan = { kind: "lan" as const, priority: 0, url: "ws://10.0.0.2:1" };
    expect(reachabilityLabel(status({ endpoints: [lan] }))).toBe("1 way in");
    expect(reachabilityLabel(status())).toBe("starting");
    expect(
      reachabilityTone(status({ managedTunnel: tunnel({ phase: "error" }) })),
    ).toBe("error");
  });
});
