/**
 * The preflight behind the share dialog: it only reports a blocker when
 * nothing on this Mac could carry a link.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  installable: false,
  found: false,
  tunnelUp: false,
  tailnetOnly: false,
}));

vi.mock("./endpoints", () => ({
  getEndpoints: () => [
    ...(env.tunnelUp
      ? [{ kind: "cloudflare", url: "wss://x", priority: 2 }]
      : []),
    ...(env.tailnetOnly
      ? [{ kind: "tailscale", url: "ws://100.64.0.2:47615", priority: 1 }]
      : []),
  ],
}));
vi.mock("./cloudflared", () => ({
  canInstallCloudflared: () => env.installable,
  findCloudflared: async () =>
    env.found ? { path: "/usr/local/bin/cloudflared", source: "path" } : null,
}));
vi.mock("./tunnelManager", () => ({
  getTunnelState: () => ({ status: "stopped", publicUrl: null }),
}));

const { checkShareReadiness } = await import("./shareReadiness");

describe("checkShareReadiness", () => {
  beforeEach(() => {
    env.installable = false;
    env.found = false;
    env.tunnelUp = false;
    env.tailnetOnly = false;
  });

  it("is ready when a tunnel is already carrying traffic", async () => {
    env.tunnelUp = true;

    await expect(checkShareReadiness()).resolves.toEqual({ ready: true });
  });

  it("is ready when Argus can install cloudflared itself", async () => {
    env.installable = true;

    await expect(checkShareReadiness()).resolves.toEqual({ ready: true });
  });

  it("is ready with a cloudflared of the user's own", async () => {
    env.found = true;

    await expect(checkShareReadiness()).resolves.toEqual({ ready: true });
  });

  it("doesn't count a tailnet address: a guest's browser can't reach it", async () => {
    env.tailnetOnly = true;

    const { ready, blocker } = await checkShareReadiness();

    expect(ready).toBe(false);
    expect(blocker?.kind).toBe("cloudflared-missing");
  });
});
