import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addHostEventSink, resetHostEventSinks } from "@argus/host/bus";
import {
  CLAIM_IDLE_MS,
  claimDevice,
  claimState,
  getClaim,
  releaseConnection,
  releaseDevice,
  resetClaims,
  WAITING_TTL_MS,
} from "./deviceClaims";

const holderA = {
  connectionId: "conn-a",
  deviceId: "dev-a",
  label: "Laptop",
};
const holderB = {
  connectionId: "conn-b",
  deviceId: "dev-b",
  label: "Mac mini",
};

describe("deviceClaims", () => {
  let published: { device_id: string; holder: unknown }[];

  beforeEach(() => {
    vi.useFakeTimers();
    resetClaims();
    resetHostEventSinks();
    published = [];
    addHostEventSink((channel, args) => {
      if (channel === "devices:claim-changed") {
        published.push(args[0] as { device_id: string; holder: unknown });
      }
    });
  });

  afterEach(() => {
    resetClaims();
    resetHostEventSinks();
    vi.useRealTimers();
  });

  it("announces the idle lapse instead of leaving clients stuck", () => {
    claimDevice("sim-1", holderA);
    expect(published).toHaveLength(1);

    vi.advanceTimersByTime(CLAIM_IDLE_MS + 100);

    expect(published.at(-1)).toMatchObject({
      device_id: "sim-1",
      holder: null,
    });
    expect(getClaim("sim-1")).toBeNull();
  });

  it("takes the next client's claim without a force once it has lapsed", () => {
    claimDevice("sim-1", holderA);
    vi.advanceTimersByTime(CLAIM_IDLE_MS + 100);

    expect(claimDevice("sim-1", holderB).granted).toBe(true);
    expect(getClaim("sim-1")?.label).toBe("Mac mini");
  });

  it("keeps the lapse alive while the holder is still driving", () => {
    claimDevice("sim-1", holderA);
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(CLAIM_IDLE_MS / 2);
      claimDevice("sim-1", holderA);
    }

    expect(getClaim("sim-1")?.label).toBe("Laptop");
    // Only the initial acquisition was announced — a refresh changes nothing.
    expect(published).toHaveLength(1);
  });

  it("cancels the lapse announcement once released explicitly", () => {
    claimDevice("sim-1", holderA);
    releaseDevice("sim-1", holderA.connectionId);
    published = [];

    vi.advanceTimersByTime(CLAIM_IDLE_MS * 2);

    expect(published).toEqual([]);
  });

  it("keeps two devices' claims apart", () => {
    claimDevice("sim-1", holderA);
    claimDevice("browser:sess-1", holderB);

    expect(claimState("sim-1").holder?.label).toBe("Laptop");
    expect(claimState("browser:sess-1").holder?.label).toBe("Mac mini");
  });
});

describe("who is being refused the device", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetClaims();
  });
  afterEach(() => {
    resetClaims();
    vi.useRealTimers();
  });

  it("lists the refused client, so the holder knows someone is trying", () => {
    claimDevice("sim-1", holderA);
    claimDevice("sim-1", holderB);

    expect(claimState("sim-1").waiting.map((w) => w.label)).toEqual([
      "Mac mini",
    ]);
  });

  it("announces the first refusal, and stays quiet for the rest of the run", () => {
    const published: unknown[] = [];
    resetHostEventSinks();
    addHostEventSink((channel, args) => {
      if (channel === "devices:claim-changed") {
        published.push(args[0]);
      }
    });
    claimDevice("sim-1", holderA);
    published.length = 0;
    // A finger held down refuses many times a second.
    claimDevice("sim-1", holderB);
    claimDevice("sim-1", holderB);
    claimDevice("sim-1", holderB);

    expect(published).toHaveLength(1);
    resetHostEventSinks();
  });

  it("forgets someone who has given up", () => {
    claimDevice("sim-1", holderA);
    claimDevice("sim-1", holderB);
    vi.advanceTimersByTime(WAITING_TTL_MS + 1);
    // Keep the holder alive so the device is still contended.
    claimDevice("sim-1", holderA);

    expect(claimState("sim-1").waiting).toEqual([]);
  });

  it("stops listing them once they get the device", () => {
    claimDevice("sim-1", holderA);
    claimDevice("sim-1", holderB);
    claimDevice("sim-1", holderB, true);

    expect(claimState("sim-1").waiting).toEqual([]);
    expect(claimState("sim-1").holder?.label).toBe("Mac mini");
  });

  it("nobody waits for a device nobody holds", () => {
    claimDevice("sim-1", holderA);
    claimDevice("sim-1", holderB);
    releaseDevice("sim-1", holderA.connectionId);

    expect(claimState("sim-1")).toMatchObject({ holder: null, waiting: [] });
  });

  it("drops a client that disconnected mid-attempt", () => {
    claimDevice("sim-1", holderA);
    claimDevice("sim-1", holderB);
    releaseConnection(holderB.connectionId);

    expect(claimState("sim-1").waiting).toEqual([]);
  });
});
