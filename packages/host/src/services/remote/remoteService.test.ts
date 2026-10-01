import type { ShareError } from "./shareError";
import type { TunnelProvider, TunnelState } from "./tunnelManager";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The typed failure a share attempt rejected with. */
async function shareFailure(pending: Promise<unknown>): Promise<ShareError> {
  try {
    await pending;
  } catch (e) {
    return e as ShareError;
  }
  throw new Error("expected the share to fail");
}

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
/** URLs the probe should report as published-but-dead. */
const reach = vi.hoisted(() => ({ unreachable: new Set<string>() }));
const gateway = vi.hoisted(() => ({
  starts: [] as { host: string; staticDir: string | null }[],
  stops: 0,
}));
const tunnels = vi.hoisted(() => {
  const stopped = (): TunnelState => ({
    status: "stopped",
    publicUrl: null,
    error: null,
    reachable: null,
  });

  return {
    states: {
      cloudflare: stopped(),
      tailscale: stopped(),
    } as Record<TunnelProvider, TunnelState>,
    /** What a started provider resolves to, applied a tick after startTunnel. */
    outcome: {} as Partial<Record<TunnelProvider, Partial<TunnelState>>>,
    starts: [] as TunnelProvider[],
    stops: [] as (TunnelProvider | undefined)[],
    listeners: new Set<() => void>(),
    /** Whether `cloudflared` resolves on PATH. */
    installed: true,
    reset(): void {
      this.states = { cloudflare: stopped(), tailscale: stopped() };
      this.installed = true;
      this.outcome = {};
      this.starts = [];
      this.stops = [];
      this.listeners.clear();
    },
    set(provider: TunnelProvider, next: Partial<TunnelState>): void {
      this.states[provider] = { ...this.states[provider], ...next };
      for (const cb of [...this.listeners]) {
        cb();
      }
    },
  };
});

vi.mock("../appSettings/store", () => ({
  loadAppSettings: () => settings.value,
  saveAppSettings: (patch: Record<string, unknown>) => {
    settings.value = { ...settings.value, ...patch };
  },
}));
vi.mock("./deviceStore", () => ({
  getDesktopIdentity: async () => ({
    priv: new Uint8Array(32),
    pub: new Uint8Array(32),
  }),
  listDevices: async () => [],
  onDevicesChanged: () => () => {},
}));
vi.mock("./gateway", () => ({
  broadcastEndpoints: () => {},
  clearConnections: () => {},
  getConnectedDeviceIds: () => [],
  setConnectionsChangedListener: () => {},
}));
vi.mock("./localGatewayServer", () => ({
  startLocalGateway: async (
    _port: number,
    _identity: unknown,
    opts: { host: string; staticDir: string | null },
  ) => {
    gateway.starts.push(opts);

    return 47615;
  },
  stopLocalGateway: () => {
    gateway.stops += 1;
  },
}));
vi.mock("./tunnelManager", () => ({
  binaryOnPath: () => tunnels.installed,
  TUNNEL_PROVIDERS: ["tailscale", "cloudflare"] as TunnelProvider[],
  getTunnelState: (p: TunnelProvider) => tunnels.states[p],
  getTunnelStates: () => tunnels.states,
  onTunnelChange: () => {},
  subscribeTunnelChange: (cb: () => void) => {
    tunnels.listeners.add(cb);

    return () => tunnels.listeners.delete(cb);
  },
  startTunnel: (opts: { provider: TunnelProvider }) => {
    tunnels.starts.push(opts.provider);
    tunnels.states[opts.provider] = {
      status: "starting",
      publicUrl: null,
      error: null,
      reachable: null,
    };
    const outcome = tunnels.outcome[opts.provider];
    if (outcome) {
      queueMicrotask(() => tunnels.set(opts.provider, outcome));
    }
  },
  markTunnelReachability: (
    provider: TunnelProvider,
    url: string,
    reachable: boolean,
  ) => {
    if (tunnels.states[provider].publicUrl === url) {
      tunnels.set(provider, { reachable });
    }
  },
  stopTunnel: (provider?: TunnelProvider) => {
    tunnels.stops.push(provider);
    for (const p of provider
      ? [provider]
      : (["cloudflare", "tailscale"] as const)) {
      tunnels.states[p] = {
        status: "stopped",
        publicUrl: null,
        error: null,
        reachable: null,
      };
    }
  },
}));
vi.mock("./reachability", () => ({
  probeGatewayUrl: async (url: string) => reach.unreachable.has(url) === false,
}));
vi.mock("node:os", () => ({
  networkInterfaces: () => ({
    en0: [{ family: "IPv4", address: "192.168.1.79", internal: false }],
  }),
}));

const {
  acquirePublicUrl,
  applyRemoteSettings,
  publicUrlLeaseCount,
  releasePublicUrl,
  setWebClientDir,
  stopRemote,
} = await import("./remoteService");

const WEB_DIR = "/tmp/argus-web";
const CF_URL = "wss://demo.trycloudflare.com";
const TS_URL = "wss://mac.tail.ts.net";

/** The URL a provider will publish shortly after it is started. */
function willPublish(provider: TunnelProvider, url: string): void {
  tunnels.outcome[provider] = { status: "running", publicUrl: url };
}

function reset(): void {
  stopRemote();
  while (publicUrlLeaseCount() > 0) {
    releasePublicUrl();
  }
  gateway.starts = [];
  gateway.stops = 0;
  tunnels.reset();
  reach.unreachable.clear();
  settings.value = { remote_enabled: true };
  setWebClientDir(WEB_DIR);
}

describe("bind/serve matrix", () => {
  beforeEach(reset);

  it("binds every interface and serves the bundle when remote access is on", async () => {
    await applyRemoteSettings();

    expect(gateway.starts.at(-1)).toEqual({
      host: "0.0.0.0",
      staticDir: WEB_DIR,
    });
  });

  it("keeps the network bind alongside a tunnel", async () => {
    settings.value = { remote_enabled: true, remote_cloudflare_enabled: true };
    await applyRemoteSettings();

    expect(gateway.starts.at(-1)?.host).toBe("0.0.0.0");
  });

  it("does not listen at all when remote access is off", async () => {
    settings.value = { remote_enabled: false };
    const before = gateway.starts.length;
    await applyRemoteSettings();

    expect(gateway.starts).toHaveLength(before);
  });

  it("serves nothing when there is no bundle on disk", async () => {
    setWebClientDir(null);
    await applyRemoteSettings();

    expect(gateway.starts.at(-1)?.staticDir).toBeNull();
  });
});

describe("acquirePublicUrl", () => {
  beforeEach(reset);

  it("raises a quick tunnel when nothing public is up", async () => {
    willPublish("cloudflare", CF_URL);
    const lease = await acquirePublicUrl({ timeoutMs: 1000 });

    expect(tunnels.starts).toEqual(["cloudflare"]);
    expect(lease).toEqual({
      url: CF_URL,
      webUrl: "https://demo.trycloudflare.com",
      kind: "cloudflare",
      raised: true,
    });
  });

  it("starts a loopback-only gateway if remote access is off", async () => {
    settings.value = { remote_enabled: false };
    willPublish("cloudflare", CF_URL);
    await acquirePublicUrl({ timeoutMs: 1000 });

    expect(gateway.starts.at(-1)).toEqual({
      host: "127.0.0.1",
      staticDir: WEB_DIR,
    });
  });

  it("reuses a running Tailscale funnel instead of raising Cloudflare", async () => {
    settings.value = { remote_enabled: true, remote_tailscale_enabled: true };
    await applyRemoteSettings();
    tunnels.set("tailscale", { status: "running", publicUrl: TS_URL });
    tunnels.starts = [];

    const lease = await acquirePublicUrl({ timeoutMs: 1000 });

    expect(tunnels.starts).toEqual([]);
    expect(lease).toMatchObject({
      kind: "tailscale",
      url: TS_URL,
      raised: false,
    });
  });

  it("skips a funnel that published a URL but answers nothing", async () => {
    settings.value = { remote_enabled: true, remote_tailscale_enabled: true };
    await applyRemoteSettings();
    tunnels.set("tailscale", { status: "running", publicUrl: TS_URL });
    reach.unreachable.add(TS_URL);
    tunnels.starts = [];
    willPublish("cloudflare", CF_URL);

    const lease = await acquirePublicUrl({ timeoutMs: 1000 });

    expect(lease).toMatchObject({ kind: "cloudflare", url: CF_URL });
    expect(tunnels.states.tailscale.reachable).toBe(false);
  });

  it("does not clobber the user's Cloudflare tunnel when it is unreachable", async () => {
    settings.value = { remote_enabled: true, remote_cloudflare_enabled: true };
    await applyRemoteSettings();
    tunnels.set("cloudflare", { status: "running", publicUrl: CF_URL });
    reach.unreachable.add(CF_URL);
    tunnels.starts = [];

    const failure = await shareFailure(acquirePublicUrl({ timeoutMs: 1000 }));

    expect(failure.detail).toMatch(/didn't route back/);
    expect(tunnels.starts).toEqual([]);
    expect(publicUrlLeaseCount()).toBe(0);
  });

  it("fails rather than leasing a quick tunnel nothing answers on", async () => {
    willPublish("cloudflare", CF_URL);
    reach.unreachable.add(CF_URL);

    await expect(acquirePublicUrl({ timeoutMs: 1000 })).rejects.toThrow(
      /Couldn't get a public link/,
    );
    expect(publicUrlLeaseCount()).toBe(0);
    expect(tunnels.stops).toContain("cloudflare");
  });

  it("waits for a user tunnel that is still coming up", async () => {
    settings.value = { remote_enabled: true, remote_tailscale_enabled: true };
    tunnels.set("tailscale", { status: "starting" });
    queueMicrotask(() =>
      tunnels.set("tailscale", { status: "running", publicUrl: TS_URL }),
    );

    const lease = await acquirePublicUrl({ timeoutMs: 1000 });

    expect(tunnels.starts).toEqual([]);
    expect(lease.kind).toBe("tailscale");
  });

  it("falls back to a quick tunnel when the user tunnel fails", async () => {
    settings.value = { remote_enabled: true, remote_tailscale_enabled: true };
    tunnels.set("tailscale", { status: "starting" });
    queueMicrotask(() =>
      tunnels.set("tailscale", { status: "error", error: "logged out" }),
    );
    willPublish("cloudflare", CF_URL);

    await expect(acquirePublicUrl({ timeoutMs: 1000 })).resolves.toMatchObject({
      kind: "cloudflare",
    });
    expect(tunnels.starts).toEqual(["cloudflare"]);
  });

  it("explains an unraisable quick tunnel and leaves nothing behind", async () => {
    tunnels.outcome.cloudflare = {
      status: "error",
      error: "429 too many requests",
    };

    const failure = await shareFailure(acquirePublicUrl({ timeoutMs: 1000 }));

    expect(failure.kind).toBe("quick-tunnel-failed");
    expect(failure.detail).toMatch(/429 too many requests/);
    expect(failure.explanation).toMatch(/rate-limits/);
    expect(publicUrlLeaseCount()).toBe(0);
    expect(tunnels.stops).toContain("cloudflare");
  });

  it("times out with actionable advice", async () => {
    const failure = await shareFailure(acquirePublicUrl({ timeoutMs: 10 }));

    expect(failure.detail).toMatch(/no URL after/);
    expect(failure.steps.join(" ")).toMatch(/Settings → Remote access/);
  });

  it("explains the missing CLI instead of blaming Cloudflare", async () => {
    tunnels.installed = false;
    tunnels.outcome.cloudflare = {
      status: "error",
      error: "`cloudflared` isn't on Argus's PATH.",
    };

    const failure = await shareFailure(acquirePublicUrl({ timeoutMs: 1000 }));

    expect(failure.kind).toBe("cloudflared-missing");
    expect(failure.command).toBe("brew install cloudflared");
    expect(failure.explanation).not.toMatch(/rate-limit/);
    expect(publicUrlLeaseCount()).toBe(0);
  });
});

describe("releasePublicUrl", () => {
  beforeEach(reset);

  it("keeps the tunnel up while another huddle holds a lease", async () => {
    willPublish("cloudflare", CF_URL);
    await acquirePublicUrl({ timeoutMs: 1000 });
    const second = await acquirePublicUrl({ timeoutMs: 1000 });

    expect(second.url).toBe(CF_URL);
    expect(publicUrlLeaseCount()).toBe(2);

    releasePublicUrl();

    expect(tunnels.stops).toEqual([]);
    expect(tunnels.states.cloudflare.publicUrl).toBe(CF_URL);

    releasePublicUrl();

    expect(tunnels.stops).toEqual(["cloudflare"]);
  });

  it("never stops a tunnel the user turned on themselves", async () => {
    settings.value = { remote_enabled: true, remote_cloudflare_enabled: true };
    await applyRemoteSettings();
    tunnels.set("cloudflare", { status: "running", publicUrl: CF_URL });
    tunnels.stops = [];

    const lease = await acquirePublicUrl({ timeoutMs: 1000 });
    releasePublicUrl();

    expect(lease.raised).toBe(false);
    expect(tunnels.stops).toEqual([]);
    expect(tunnels.states.cloudflare.publicUrl).toBe(CF_URL);
  });

  it("drops ownership when a settings change restarts the tunnel", async () => {
    willPublish("cloudflare", CF_URL);
    await acquirePublicUrl({ timeoutMs: 1000 });

    settings.value = { remote_enabled: true, remote_cloudflare_enabled: true };
    await applyRemoteSettings();
    tunnels.set("cloudflare", { status: "running", publicUrl: CF_URL });
    tunnels.stops = [];

    releasePublicUrl();

    expect(tunnels.stops).toEqual([]);
  });

  it("ignores a release with no outstanding lease", () => {
    releasePublicUrl();

    expect(publicUrlLeaseCount()).toBe(0);
  });
});
