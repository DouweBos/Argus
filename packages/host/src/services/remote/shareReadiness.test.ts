/**
 * The preflight behind the share dialog: it only reports a blocker when
 * nothing on this Mac could carry a link, and it explains whichever provider
 * the user actually picked.
 */

import type { TailscaleDiagnosis, TailscaleStep } from "./tailscaleSetup";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  cloudflared: false,
  tailscaleEnabled: false,
  tunnelUp: false,
  diagnosis: null as TailscaleDiagnosis | null,
}));

vi.mock("./endpoints", () => ({
  getEndpoints: () =>
    env.tunnelUp ? [{ kind: "cloudflare", url: "wss://x", priority: 2 }] : [],
}));
vi.mock("./remoteService", () => ({
  enabledProviders: () => (env.tailscaleEnabled ? ["tailscale"] : []),
}));
vi.mock("./tunnelManager", () => ({
  binaryOnPath: () => env.cloudflared,
  getTunnelState: () => ({ status: "stopped", publicUrl: null }),
}));
vi.mock("./tailscaleSetup", () => ({
  diagnoseTailscale: async () => env.diagnosis,
}));

const { checkShareReadiness } = await import("./shareReadiness");

function step(overrides: Partial<TailscaleStep> = {}): TailscaleStep {
  return {
    id: "login",
    title: "Signed in",
    state: "fail",
    message: "This Mac isn't signed into a tailnet.",
    detail: "BackendState: NeedsLogin",
    fix: "sign-in",
    fixLabel: "Sign in",
    url: null,
    ...overrides,
  };
}

function diagnosis(ready: boolean, steps: TailscaleStep[]): TailscaleDiagnosis {
  return { ready, steps, bin: "/usr/bin/tailscale", dnsName: null };
}

describe("checkShareReadiness", () => {
  beforeEach(() => {
    env.cloudflared = false;
    env.tailscaleEnabled = false;
    env.tunnelUp = false;
    env.diagnosis = null;
  });

  it("is ready when a tunnel is already carrying traffic", async () => {
    env.tunnelUp = true;

    await expect(checkShareReadiness()).resolves.toEqual({ ready: true });
  });

  it("explains the missing CLI when nothing else can carry a link", async () => {
    const { blocker } = await checkShareReadiness();

    expect(blocker?.kind).toBe("cloudflared-missing");
    expect(blocker?.command).toBe("brew install cloudflared");
  });

  it("walks through Tailscale's first failing step when that's the pick", async () => {
    env.tailscaleEnabled = true;
    env.diagnosis = diagnosis(false, [step()]);

    const { ready, blocker } = await checkShareReadiness();

    expect(ready).toBe(false);
    expect(blocker?.kind).toBe("tailscale-not-ready");
    expect(blocker?.message).toBe("Tailscale isn't signed in");
    expect(blocker?.explanation).toContain("isn't signed into a tailnet");
    expect(blocker?.detail).toBe("BackendState: NeedsLogin");
  });

  it("stays quiet about Tailscale when the quick tunnel can still carry it", async () => {
    env.cloudflared = true;
    env.tailscaleEnabled = true;
    env.diagnosis = diagnosis(false, [step()]);

    await expect(checkShareReadiness()).resolves.toEqual({ ready: true });
  });

  it("is ready once every Tailscale check passes", async () => {
    env.tailscaleEnabled = true;
    env.diagnosis = diagnosis(true, [step({ state: "ok" })]);

    await expect(checkShareReadiness()).resolves.toEqual({ ready: true });
  });
});
