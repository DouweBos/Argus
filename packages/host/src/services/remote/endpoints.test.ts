import { beforeEach, describe, expect, it, vi } from "vitest";

const tunnels = vi.hoisted(() => ({
  value: {
    cloudflare: { publicUrl: null },
    tailscale: { publicUrl: null },
  } as Record<string, { publicUrl: string | null }>,
}));
const managed = vi.hoisted(() => ({ url: null as string | null }));
const net = vi.hoisted(() => ({ tailnet: true }));

vi.mock("./tunnelManager", () => ({
  getTunnelStates: () => tunnels.value,
}));
vi.mock("./managedTunnel", () => ({
  getManagedTunnelUrl: () => managed.url,
}));
vi.mock("node:os", () => ({
  networkInterfaces: () => ({
    // Tailscale's interface can come first; it must never pass for the LAN.
    ...(net.tailnet
      ? { utun3: [{ family: "IPv4", address: "100.88.1.2", internal: false }] }
      : {}),
    en0: [{ family: "IPv4", address: "192.168.1.79", internal: false }],
    lo0: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
  }),
}));

const {
  getEndpoints,
  isDirectLanPeer,
  isTailnetAddress,
  setGatewayOnLan,
  LOCAL_GATEWAY_PORT,
} = await import("./endpoints");

const LAN_URL = `ws://192.168.1.79:${LOCAL_GATEWAY_PORT}`;
const TAILNET_URL = `ws://100.88.1.2:${LOCAL_GATEWAY_PORT}`;
const MANAGED_URL = "wss://argus-0123456789abcdef.houwert.dev";

describe("getEndpoints", () => {
  beforeEach(() => {
    tunnels.value = {
      cloudflare: { publicUrl: null },
      tailscale: { publicUrl: null },
    };
    managed.url = null;
    net.tailnet = true;
    setGatewayOnLan(true);
  });

  it("ranks LAN before the tailnet before the managed tunnel", () => {
    managed.url = MANAGED_URL;

    expect(getEndpoints()).toEqual([
      { kind: "lan", url: LAN_URL, priority: 0 },
      { kind: "tailscale", url: TAILNET_URL, priority: 1 },
      { kind: "cloudflare", url: MANAGED_URL, priority: 2 },
    ]);
  });

  it("leaves out the tailnet when Tailscale isn't connected", () => {
    net.tailnet = false;

    expect(getEndpoints().map((e) => e.kind)).toEqual(["lan"]);
  });

  it("omits the managed tunnel until it registers", () => {
    expect(getEndpoints().map((e) => e.kind)).toEqual(["lan", "tailscale"]);
  });

  it("lets an earlier version's Funnel stand in for the tailnet address", () => {
    tunnels.value.tailscale.publicUrl = "wss://mac.tail.ts.net";

    expect(getEndpoints().find((e) => e.kind === "tailscale")?.url).toBe(
      "wss://mac.tail.ts.net",
    );
  });

  it("prefers the managed tunnel over an earlier version's Cloudflare tunnel", () => {
    tunnels.value.cloudflare.publicUrl = "wss://x.trycloudflare.com";
    expect(getEndpoints().at(-1)?.url).toBe("wss://x.trycloudflare.com");

    managed.url = MANAGED_URL;
    expect(getEndpoints().at(-1)?.url).toBe(MANAGED_URL);
  });

  it("omits direct addresses while the gateway is off the network", () => {
    setGatewayOnLan(false);
    managed.url = MANAGED_URL;

    expect(getEndpoints().map((e) => e.kind)).toEqual(["cloudflare"]);
  });

  it("returns nothing when there is no way in", () => {
    setGatewayOnLan(false);

    expect(getEndpoints()).toEqual([]);
  });
});

describe("isTailnetAddress", () => {
  it("matches Tailscale's 100.64.0.0/10 and nothing around it", () => {
    expect(isTailnetAddress("100.64.0.1")).toBe(true);
    expect(isTailnetAddress("100.127.255.254")).toBe(true);
    expect(isTailnetAddress("100.63.255.255")).toBe(false);
    expect(isTailnetAddress("100.128.0.1")).toBe(false);
    expect(isTailnetAddress("10.0.0.4")).toBe(false);
  });
});

describe("isDirectLanPeer", () => {
  it("is true only for a peer on the local network itself", () => {
    expect(isDirectLanPeer("192.168.1.20")).toBe(true);
    expect(isDirectLanPeer("::ffff:10.0.0.4")).toBe(true);
  });

  it("is false for loopback, where the tunnels arrive, and the tailnet", () => {
    expect(isDirectLanPeer("127.0.0.1")).toBe(false);
    expect(isDirectLanPeer("::ffff:127.0.0.1")).toBe(false);
    expect(isDirectLanPeer("::1")).toBe(false);
    expect(isDirectLanPeer("100.101.102.103")).toBe(false);
    expect(isDirectLanPeer(undefined)).toBe(false);
  });
});
