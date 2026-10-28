import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeSocket {
  closed: boolean;
  onState: (state: string) => void;
  url: string;
}

const sockets: FakeSocket[] = [];

vi.mock("@argus/remote-client", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  Transport: class {
    private readonly socket: FakeSocket;
    constructor(
      creds: { url: string },
      handlers: { onState: (state: string) => void },
    ) {
      this.socket = {
        closed: false,
        onState: handlers.onState,
        url: creds.url,
      };
      sockets.push(this.socket);
    }
    connect() {}
    disconnect() {
      this.socket.closed = true;
    }
    subscribe() {}
    request() {
      return Promise.resolve(null);
    }
  },
}));

const { RouteDialer } = await import("./routeDialer");
const { UPGRADE_INTERVAL_MS, attemptTimeoutMs } =
  await import("./endpointRanking");

const LAN = { kind: "lan" as const, priority: 0, url: "ws://10.0.0.2:1" };
const TAILNET = {
  kind: "tailscale" as const,
  priority: 1,
  url: "ws://100.101.2.3:1",
};
const TUNNEL = {
  kind: "cloudflare" as const,
  priority: 2,
  url: "wss://argus-abc.houwert.dev",
};

/** The newest socket dialed to `url` that is still open. */
const live = (url: string) =>
  [...sockets].reverse().find((s) => s.url === url && !s.closed);

function dialer() {
  const states: string[] = [];
  const routes: string[] = [];
  const d = new RouteDialer(
    { devPrivB64: "", devPubB64: "", hostPubB64: "" },
    LAN.url,
    [TUNNEL, TAILNET, LAN],
    {
      onState: (s) => states.push(s),
      onEvent: () => undefined,
      onRoute: (url) => routes.push(url),
    },
  );

  return { d, routes, states };
}

describe("routeDialer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dials the best route first", () => {
    const { d, states } = dialer();
    d.connect();
    live(LAN.url)?.onState("ready");
    expect(d.currentUrl).toBe(LAN.url);
    expect(states).toEqual(["connecting", "ready"]);
  });

  it("falls back to the tailnet, then the tunnel", () => {
    const { d, routes, states } = dialer();
    d.connect();
    live(LAN.url)?.onState("offline");
    expect(live(TAILNET.url)).toBeDefined();
    vi.advanceTimersByTime(attemptTimeoutMs("tailscale"));
    live(TUNNEL.url)?.onState("ready");
    expect(d.currentUrl).toBe(TUNNEL.url);
    expect(routes).toEqual([TUNNEL.url]);
    // No offline flicker while there was still a route to try.
    expect(states).toEqual(["connecting", "ready"]);
  });

  it("goes offline and backs off once every route failed", () => {
    const { d, states } = dialer();
    d.connect();
    for (const url of [LAN.url, TAILNET.url, TUNNEL.url]) {
      live(url)?.onState("offline");
    }
    expect(states.at(-1)).toBe("offline");
    const dialed = sockets.length;
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(dialed + 1);
    expect(sockets.at(-1)?.url).toBe(LAN.url);
  });

  it("retries at once when the network comes back", () => {
    const { d } = dialer();
    d.connect();
    for (const url of [LAN.url, TAILNET.url, TUNNEL.url]) {
      live(url)?.onState("offline");
    }
    const dialed = sockets.length;
    d.onNetworkChange();
    expect(sockets).toHaveLength(dialed + 1);
  });

  it("moves back up once a probe of a better route connects", () => {
    const { d, states } = dialer();
    d.connect();
    live(LAN.url)?.onState("offline");
    live(TAILNET.url)?.onState("offline");
    live(TUNNEL.url)?.onState("ready");

    vi.advanceTimersByTime(UPGRADE_INTERVAL_MS);
    const probe = live(LAN.url);
    expect(probe).toBeDefined();
    // The tunnel stays up while the probe runs.
    expect(live(TUNNEL.url)).toBeDefined();
    probe?.onState("ready");

    expect(live(TUNNEL.url)).toBeUndefined();
    live(LAN.url)?.onState("ready");
    expect(d.currentUrl).toBe(LAN.url);
    expect(states.slice(-2)).toEqual(["offline", "ready"]);
  });

  it("keeps the working route when a probe fails, and cools down", () => {
    const { d } = dialer();
    d.connect();
    live(LAN.url)?.onState("offline");
    live(TAILNET.url)?.onState("ready");

    vi.advanceTimersByTime(30_000);
    d.checkUpgrade();
    live(LAN.url)?.onState("offline");
    expect(d.currentUrl).toBe(TAILNET.url);
    expect(live(TAILNET.url)).toBeDefined();

    const dialed = sockets.length;
    d.checkUpgrade();
    expect(sockets).toHaveLength(dialed);
  });

  it("starts over from the best route when a working socket drops", () => {
    const { d, states } = dialer();
    d.connect();
    live(LAN.url)?.onState("offline");
    live(TAILNET.url)?.onState("ready");
    live(TAILNET.url)?.onState("offline");
    expect(states.at(-1)).toBe("offline");
    expect(sockets.at(-1)?.url).toBe(LAN.url);
  });

  it("stops dialing once disconnected", () => {
    const { d } = dialer();
    d.connect();
    d.disconnect();
    const dialed = sockets.length;
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(dialed);
    expect(sockets.every((s) => s.closed)).toBe(true);
  });
});
