import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const tunnels = vi.hoisted(() => ({
  value: {
    cloudflare: { status: "stopped", publicUrl: null, error: null },
    tailscale: { status: "stopped", publicUrl: null, error: null },
  } as Record<string, { publicUrl: string | null }>,
}));

vi.mock("../appSettings/store", () => ({
  loadAppSettings: () => settings.value,
}));
vi.mock("./tunnelManager", () => ({
  TUNNEL_PROVIDERS: ["tailscale", "cloudflare"],
  getTunnelStates: () => tunnels.value,
}));
vi.mock("node:os", () => ({
  networkInterfaces: () => ({
    en0: [{ family: "IPv4", address: "192.168.1.79", internal: false }],
    lo0: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
  }),
}));

const { getEndpoints, setGatewayOnLan, LOCAL_GATEWAY_PORT } =
  await import("./endpoints");

const LAN_URL = `ws://192.168.1.79:${LOCAL_GATEWAY_PORT}`;

describe("getEndpoints", () => {
  beforeEach(() => {
    settings.value = {};
    tunnels.value = {
      cloudflare: { publicUrl: null },
      tailscale: { publicUrl: null },
    };
    setGatewayOnLan(true);
  });

  it("ranks LAN before Tailscale before Cloudflare", () => {
    tunnels.value.tailscale.publicUrl = "wss://mac.tail.ts.net";
    tunnels.value.cloudflare.publicUrl = "wss://x.trycloudflare.com";

    expect(getEndpoints()).toEqual([
      { kind: "lan", url: LAN_URL, priority: 0 },
      { kind: "tailscale", url: "wss://mac.tail.ts.net", priority: 1 },
      { kind: "cloudflare", url: "wss://x.trycloudflare.com", priority: 2 },
    ]);
  });

  it("advertises several providers at once", () => {
    tunnels.value.tailscale.publicUrl = "wss://mac.tail.ts.net";
    tunnels.value.cloudflare.publicUrl = "wss://x.trycloudflare.com";

    expect(getEndpoints().map((e) => e.kind)).toEqual([
      "lan",
      "tailscale",
      "cloudflare",
    ]);
  });

  it("omits tunnels that haven't produced a URL yet", () => {
    tunnels.value.tailscale.publicUrl = null;

    expect(getEndpoints().map((e) => e.kind)).toEqual(["lan"]);
  });

  it("omits the LAN address while the gateway is down", () => {
    setGatewayOnLan(false);
    tunnels.value.tailscale.publicUrl = "wss://mac.tail.ts.net";

    // The tunnel URL is still listed: the daemon holds it independently of
    // whether this process is currently listening.
    expect(getEndpoints().map((e) => e.kind)).toEqual(["tailscale"]);
  });

  it("returns nothing when there is no way in", () => {
    setGatewayOnLan(false);

    expect(getEndpoints()).toEqual([]);
  });

  it("skips internal interfaces when picking the LAN address", () => {
    expect(getEndpoints()[0].url).toBe(LAN_URL);
  });
});
