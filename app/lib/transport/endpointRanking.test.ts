import { describe, expect, it } from "vitest";
import {
  attachBudgetMs,
  inferKind,
  nextRoute,
  rankRoutes,
  recordRoute,
  routeCandidates,
  upgradeCandidate,
  upgradeCooldownMs,
  type RouteHealth,
} from "./endpointRanking";

const LAN = { kind: "lan" as const, priority: 0, url: "ws://10.0.0.2:47615" };
const TAILNET = {
  kind: "tailscale" as const,
  priority: 1,
  url: "ws://100.101.2.3:47615",
};
const TUNNEL = {
  kind: "cloudflare" as const,
  priority: 2,
  url: "wss://argus-abc.houwert.dev",
};

const none = new Map<string, RouteHealth>();

describe("routeCandidates", () => {
  it("keeps a stored url the endpoint list doesn't name, last", () => {
    const out = routeCandidates("ws://192.168.1.9:47615", [TUNNEL, LAN]);
    expect(out.map((c) => c.url)).toEqual([
      TUNNEL.url,
      LAN.url,
      "ws://192.168.1.9:47615",
    ]);
    expect(out[2].priority).toBeGreaterThan(TUNNEL.priority);
  });

  it("works for an old host with no endpoints at all", () => {
    expect(routeCandidates(TUNNEL.url, undefined)).toEqual([
      expect.objectContaining({ kind: "cloudflare", url: TUNNEL.url }),
    ]);
  });

  it("drops duplicate urls", () => {
    expect(routeCandidates(LAN.url, [LAN, LAN])).toHaveLength(1);
  });
});

describe("inferKind", () => {
  it("tells the tailnet range from a LAN and a tunnel", () => {
    expect(inferKind("ws://100.64.0.1:1")).toBe("tailscale");
    expect(inferKind("ws://100.200.0.1:1")).toBe("lan");
    expect(inferKind("ws://192.168.1.2:1")).toBe("lan");
    expect(inferKind("wss://x.example")).toBe("cloudflare");
  });
});

describe("rankRoutes", () => {
  it("orders by priority", () => {
    expect(rankRoutes([TUNNEL, LAN, TAILNET], none)).toEqual([
      LAN,
      TAILNET,
      TUNNEL,
    ]);
  });

  it("breaks priority ties on the route that worked most recently", () => {
    const other = { ...LAN, url: "ws://10.0.0.3:47615" };
    const health = recordRoute(none, other.url, true, 50);
    expect(rankRoutes([LAN, other], health)[0]).toBe(other);
  });
});

describe("nextRoute", () => {
  const ranked = [LAN, TAILNET, TUNNEL];

  it("falls back down the list", () => {
    expect(nextRoute(ranked, LAN.url, new Set([LAN.url]))).toBe(TAILNET);
    expect(
      nextRoute(ranked, TAILNET.url, new Set([LAN.url, TAILNET.url])),
    ).toBe(TUNNEL);
  });

  it("wraps to routes not yet tried this cycle", () => {
    expect(
      nextRoute(ranked, TUNNEL.url, new Set([TAILNET.url, TUNNEL.url])),
    ).toBe(LAN);
  });

  it("returns null once every route had its turn", () => {
    expect(
      nextRoute(ranked, TUNNEL.url, new Set(ranked.map((c) => c.url))),
    ).toBeNull();
  });
});

describe("upgradeCandidate", () => {
  const ranked = [LAN, TAILNET, TUNNEL];

  it("offers the best route above the current one", () => {
    expect(upgradeCandidate(ranked, TUNNEL.url, none, 0)).toBe(LAN);
  });

  it("has nothing to offer on the best route", () => {
    expect(upgradeCandidate(ranked, LAN.url, none, 0)).toBeNull();
  });

  it("skips a route still cooling down after a failure", () => {
    const health = recordRoute(none, LAN.url, false, 1_000);
    expect(upgradeCandidate(ranked, TUNNEL.url, health, 2_000)).toBe(TAILNET);
    expect(
      upgradeCandidate(
        ranked,
        TUNNEL.url,
        health,
        1_000 + upgradeCooldownMs(1),
      ),
    ).toBe(LAN);
  });

  it("never offers a route of the same priority", () => {
    const twin = { ...TAILNET, url: "ws://100.101.2.4:47615" };
    expect(upgradeCandidate([LAN, TAILNET, twin], twin.url, none, 0)).toBe(LAN);
    expect(upgradeCandidate([TAILNET, twin], twin.url, none, 0)).toBeNull();
  });
});

describe("cooldown and budget", () => {
  it("doubles the cooldown per failure up to a cap", () => {
    expect(upgradeCooldownMs(0)).toBe(0);
    expect(upgradeCooldownMs(2)).toBe(2 * upgradeCooldownMs(1));
    expect(upgradeCooldownMs(50)).toBe(upgradeCooldownMs(60));
  });

  it("resets failures once a route works", () => {
    const failed = recordRoute(none, LAN.url, false, 1);
    expect(recordRoute(failed, LAN.url, true, 2).get(LAN.url)).toEqual({
      failures: 0,
      failedAt: null,
      lastGoodAt: 2,
    });
  });

  it("budgets an attach for one attempt per route", () => {
    expect(attachBudgetMs(LAN.url, [LAN, TAILNET, TUNNEL])).toBeGreaterThan(
      attachBudgetMs(LAN.url, [LAN]),
    );
  });
});
